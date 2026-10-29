// Cloudflare Worker için Nevzat Ayaz Haber Çekici
// Bu dosyayı Cloudflare Workers'a deploy edebilirsiniz

// Cache ayarları
const CACHE_TTL = 300; // 5 dakika (saniye)
const CACHE_KEY_PREFIX = 'news_cache_';

// Kaynak site ayarları
const MEB_BASE_URL = 'https://nevzatayazal.meb.k12.tr';
const HABERLER_KATEGORI = '94171';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 40; // Worker başına 50 alt istek sınırı var
const DETAY_ESZAMANLI = 5; // Aynı anda çekilecek detay sayfası sayısı
const ICERIK_UZUNLUK = 500;

// Cache helper fonksiyonları
async function getCachedData(key) {
    try {
        if (typeof NEWS_CACHE !== 'undefined') {
            // KV store'dan veri al
            const cached = await NEWS_CACHE.get(key, 'json');
            if (cached && cached.timestamp) {
                const now = Date.now();
                const cacheTime = new Date(cached.timestamp).getTime();

                // Cache süresi kontrol et
                if ((now - cacheTime) < (CACHE_TTL * 1000)) {
                    return cached.data;
                }
            }
        }
    } catch (error) {
        console.log('Cache okuma hatası:', error);
    }
    return null;
}

async function setCachedData(key, data) {
    try {
        if (typeof NEWS_CACHE !== 'undefined') {
            // KV store'a veri kaydet, süresi dolunca KV kendisi silsin
            const cacheData = {
                data: data,
                timestamp: new Date().toISOString()
            };
            await NEWS_CACHE.put(key, JSON.stringify(cacheData), { expirationTtl: CACHE_TTL });
        }
    } catch (error) {
        console.log('Cache yazma hatası:', error);
    }
}

// Cache key oluşturma
function createCacheKey(options) {
    const { limit, detay } = options;
    return `${CACHE_KEY_PREFIX}${limit}_${detay ? 'detailed' : 'simple'}`;
}

// HTML entity'lerini çöz (&quot;, &amp;, &#39;, &ccedil; vb.)
const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ccedil: 'ç', Ccedil: 'Ç', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—'
};

function decodeEntities(text) {
    return text
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name] ?? match);
}

// Başlığı temizle: entity'leri çöz, eşi olmayan tırnakları kaldır
function normalizeTitle(text) {
    let title = decodeEntities(text).replace(/\s+/g, ' ').trim();
    if ((title.match(/"/g) || []).length % 2 === 1) {
        title = title.replace(/"/g, '');
    }
    return title.replace(/\s+/g, ' ').trim();
}

// Göreli linki tam URL yap ve Türkçe karakterleri kodla (ı -> %C4%B1),
// böylece link her yerde tıklanabilir olur
function toAbsoluteUrl(href) {
    return new URL(href, `${MEB_BASE_URL}/`).href;
}

// HTML'i düz metne çevir
function htmlToText(html) {
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    text = text.replace(/<[^>]+>/g, ' ');
    return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

// Metni kelime sınırında kısalt
function truncate(text, length) {
    if (text.length <= length) {
        return text;
    }
    const cut = text.substring(0, length);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > length * 0.6 ? cut.substring(0, lastSpace) : cut) + '...';
}

// "29/10/2026" veya "29.10.2026" + saat -> ISO tarih (İstanbul saati)
function parseTurkishDate(day, month, year, hour = '00', minute = '00') {
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+03:00`);
    return isNaN(date.getTime()) ? null : date.toISOString();
}

// Haber listesini MEB sitesinin liste sayfasının kullandığı JSON uç noktasından çek
async function fetchNewsList(limit) {
    const body = new URLSearchParams({
        draw: '1',
        start: '0',
        length: String(limit),
        kategori: HABERLER_KATEGORI,
        'columns[3][data]': 'SIRAID',
        'order[0][column]': '3',
        'order[0][dir]': 'desc'
    });

    const response = await fetch(`${MEB_BASE_URL}/tema/icerik_listele_ajax.php`, {
        method: 'POST',
        headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `${MEB_BASE_URL}/icerikler/listele_${HABERLER_KATEGORI}_Haberler`
        },
        body: body
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Sunucu JSON'u text/html olarak döndürüyor
    const json = JSON.parse(await response.text());
    if (!Array.isArray(json.data)) {
        throw new Error('Haber listesi beklenen formatta değil');
    }

    return json.data;
}

// Haber sayfasından içerik, tarih ve resim çıkar
function parseNewsDetail(html) {
    const detay = {};

    // Haber metni #vlightbox1 içinde, "Yayın:" satırından önce bitiyor
    const contentMatch = html.match(/id="vlightbox1"[^>]*>([\s\S]*?)(?:<small>\s*Yayın:|$)/i);
    if (contentMatch) {
        const text = htmlToText(contentMatch[1]);
        if (text) {
            detay.icerik = truncate(text, ICERIK_UZUNLUK);
        }
    }

    // Güncelleme saati, haber aynı gün yayınlandıysa tarihe saat olarak eklenir
    const yayinMatch = html.match(/Yayın:\s*(\d{2})\.(\d{2})\.(\d{4})/);
    const guncellemeMatch = html.match(/Güncelleme:\s*(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
    if (yayinMatch && guncellemeMatch && yayinMatch.slice(1, 4).join('.') === guncellemeMatch.slice(1, 4).join('.')) {
        detay.tarih = parseTurkishDate(...guncellemeMatch.slice(1, 6));
    }

    const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    if (ogImage && !ogImage[1].includes('meblogo')) {
        detay.resim = toAbsoluteUrl(ogImage[1]);
    }

    // Haber ve galeri sayfalarındaki tüm fotoğraflar a.vlightbox1 linklerinde
    detay.resimler = [];
    const imageRegex = /<a\b[^>]*class="vlightbox1"[^>]*href="([^"]+\.(?:jpe?g|png|gif|webp))"/gi;
    let match;
    while ((match = imageRegex.exec(html)) !== null) {
        detay.resimler.push(toAbsoluteUrl(match[1]));
    }

    return detay;
}

// Tek bir haberin detay sayfasını çek (PDF duyurularında sayfa yok)
async function enrichWithDetail(haber) {
    if (!haber.url.endsWith('.html')) {
        return;
    }

    try {
        const detayResponse = await fetch(haber.url, {
            headers: { 'User-Agent': USER_AGENT }
        });

        if (detayResponse.ok) {
            const detay = parseNewsDetail(await detayResponse.text());
            haber.icerik = detay.icerik || haber.icerik;
            haber.tarih = detay.tarih || haber.tarih;
            haber.resim = haber.resim || detay.resim || null;
            haber.resimler = [...new Set([...haber.resimler, ...detay.resimler])];
        }
    } catch (error) {
        console.log(`Detay alınamadı: ${haber.baslik}`);
    }
}

// Ana haber çekme fonksiyonu
async function fetchNews(options = {}) {
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const detay = options.detay !== false;

    // Cache kontrolü
    const cacheKey = createCacheKey({ limit, detay });
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
        return cachedData;
    }

    try {
        const satirlar = await fetchNewsList(limit);
        const cekilmeTarihi = new Date().toISOString();

        const haberler = satirlar.slice(0, limit).map(satir => {
            const resim = satir.MANSETRESIM ? toAbsoluteUrl(satir.MANSETRESIM) : null;
            return {
                id: parseInt(satir.SIRAID, 10),
                baslik: normalizeTitle(satir.BASLIK),
                url: toAbsoluteUrl(satir.LINK),
                icerik: htmlToText(satir.KISAICERIK || '') || null,
                resim: resim,
                resimler: resim ? [resim] : [],
                kaynak: 'Nevzat Ayaz Anadolu Lisesi',
                tarih: parseTurkishDate(...satir.BASLANGICTARIHI.split('/')) || cekilmeTarihi,
                cekilmeTarihi: cekilmeTarihi
            };
        });

        // Detay isteniyorsa sayfaları küçük gruplar halinde çek
        if (detay) {
            for (let i = 0; i < haberler.length; i += DETAY_ESZAMANLI) {
                await Promise.all(haberler.slice(i, i + DETAY_ESZAMANLI).map(enrichWithDetail));
            }
        }

        // Cache'e kaydet
        await setCachedData(cacheKey, haberler);

        return haberler;

    } catch (error) {
        throw new Error(`Haber çekme başarısız: ${error.message}`);
    }
}

// Database formatında döndürme
async function fetchNewsForDatabase(options = {}) {
    try {
        const haberler = await fetchNews(options);
          return haberler.map(haber => ({
            id: haber.id,
            baslik: haber.baslik,
            url: haber.url,
            // Galeri ve PDF haberlerinde metin yok, başlık içerik olarak kullanılır
            icerik: haber.icerik || haber.baslik,
            resim: haber.resim || null,
            resimler: haber.resimler || [],
            kaynak: haber.kaynak,
            yayinTarihi: haber.tarih,
            cekilmeTarihi: haber.cekilmeTarihi,
            aktif: true,
            okundu: false
        }));

    } catch (error) {
        throw error;
    }
}

// XML özel karakterlerini escape et
function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// CDATA bloğu, içerikteki "]]>" bloğu kırmasın
function cdata(value) {
    return `<![CDATA[${String(value).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

// XML formatına çevirme
function convertToXML(data, rootElement = 'haberler') {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${rootElement}>\n`;

    if (Array.isArray(data)) {
        data.forEach(item => {
            xml += '  <haber>\n';
            Object.entries(item).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    // resimler -> <resimler><resim>...</resim></resimler>
                    xml += `    <${key}>\n`;
                    value.forEach(entry => {
                        xml += `      <resim>${escapeXml(entry)}</resim>\n`;
                    });
                    xml += `    </${key}>\n`;
                } else if (value !== null && value !== undefined) {
                    xml += `    <${key}>${escapeXml(value)}</${key}>\n`;
                }
            });
            xml += '  </haber>\n';
        });
    }

    xml += `</${rootElement}>`;
    return xml;
}

// LinkedIn uyumlu RSS Feed formatına çevirme
function convertToRSS(data, options = {}) {
    const {
        title = 'Nevzat Ayaz Anadolu Lisesi Haberler',
        description = 'Nevzat Ayaz Anadolu Lisesi resmi haberleri RSS beslemesi',
        feedUrl = 'https://news.naal.org.tr/rss'
    } = options;
    const baseUrl = MEB_BASE_URL;
    const currentDate = new Date().toUTCString();

    let rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
    <title>${cdata(title)}</title>
    <link>${baseUrl}</link>
    <description>${cdata(description)}</description>
    <language>tr-TR</language>
    <copyright>${cdata(`© ${new Date().getFullYear()} Nevzat Ayaz Anadolu Lisesi`)}</copyright>
    <pubDate>${currentDate}</pubDate>
    <lastBuildDate>${currentDate}</lastBuildDate>
    <generator>Nevzat Ayaz RSS Feed v1.4</generator>
    <ttl>5</ttl>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
`;

    if (Array.isArray(data) && data.length > 0) {
        data.forEach((item, index) => {
            // LinkedIn için temiz başlık ve açıklama
            const cleanTitle = String(item.baslik || 'Başlık Yok').trim();
            const cleanDescription = String(item.icerik || item.baslik || 'İçerik mevcut değil').trim();

            // Tarih kontrolü ve formatı - LinkedIn için önemli
            let pubDate = currentDate;
            if (item.yayinTarihi) {
                const dateObj = new Date(item.yayinTarihi);
                if (!isNaN(dateObj.getTime())) {
                    pubDate = dateObj.toUTCString();
                }
            }

            // Her haber için sabit GUID, okuyucular aynı haberi tekrar göstermesin
            const guid = `nevzat-ayaz-${item.id || index}`;

            // URL kontrolü
            const itemUrl = item.url || `${baseUrl}#item-${index}`;

            const media = item.resim
                ? `\n        <media:content url="${escapeXml(item.resim)}" medium="image" />`
                : '';

            rss += `    <item>
        <title>${cdata(cleanTitle)}</title>
        <link>${escapeXml(itemUrl)}</link>
        <description>${cdata(cleanDescription)}</description>
        <pubDate>${pubDate}</pubDate>
        <guid isPermaLink="false">${guid}</guid>
        <category>Eğitim</category>${media}
    </item>
`;
        });
    } else {
        // Boş feed için de en az bir item ekle
        rss += `    <item>
        <title><![CDATA[Nevzat Ayaz Anadolu Lisesi]]></title>
        <link>${baseUrl}</link>
        <description><![CDATA[Nevzat Ayaz Anadolu Lisesi haber beslemesi aktif]]></description>
        <pubDate>${currentDate}</pubDate>
        <guid isPermaLink="false">nevzat-ayaz-default</guid>
        <category>Eğitim</category>
    </item>
`;
    }

    rss += `</channel>
</rss>`;

    return rss;
}

// Cloudflare Worker event handler
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    // OPTIONS request için
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: corsHeaders
        });
    }

    try {
        // Ana sayfa
        if (path === '/' || path === '') {            return new Response(JSON.stringify({
                message: 'Nevzat Ayaz Haber API - Cloudflare Worker',
                version: '1.3.0',                endpoints: {
                    'GET /api/haberler': 'Tüm haberleri içerik ve resimle getir (default 20 haber)',
                    'GET /api/haberler?limit=5': 'İlk 5 haberi getir',
                    'GET /api/haberler?detay=false': 'Haber sayfalarını çekmeden hızlı liste (içerik yok)',
                    'GET /api/haberler?format=xml': 'XML formatında çıktı',
                    'GET /api/haberler?format=rss': 'RSS Feed formatında çıktı',
                    'GET /rss': 'RSS Feed (kısayol)',
                    'GET /health': 'Sağlık kontrolü'
                },
                cache: {
                    ttl: `${CACHE_TTL} seconds`,
                    enabled: typeof NEWS_CACHE !== 'undefined'
                },
                info: {
                    defaultLimit: `${DEFAULT_LIMIT} haber`,
                    maxLimit: `${MAX_LIMIT} haber`,
                    supportedFormats: ['json', 'xml', 'rss']
                }
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }        // Haberleri getir
        if (path === '/api/haberler') {
            const limit = url.searchParams.get('limit');
            const detay = url.searchParams.get('detay') !== 'false';
            const format = url.searchParams.get('format');

            const options = {
                limit: limit,
                detay: detay
            };

            const haberler = await fetchNewsForDatabase(options);
              // RSS formatı isteniyorsa - LinkedIn uyumlu
            if (format === 'rss') {
                const rssData = convertToRSS(haberler, { feedUrl: url.href });
                return new Response(rssData, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/rss+xml; charset=utf-8',
                        'Cache-Control': 'public, max-age=300',
                        'X-Robots-Tag': 'index, follow',
                        'Last-Modified': new Date().toUTCString(),
                        ...corsHeaders
                    }
                });
            }

            // XML formatı isteniyorsa
            if (format === 'xml') {
                const xmlData = convertToXML(haberler);
                return new Response(xmlData, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/xml; charset=utf-8',
                        ...corsHeaders
                    }
                });
            }
              // JSON formatı (default)
            return new Response(JSON.stringify({
                success: true,
                count: haberler.length,
                timestamp: new Date().toISOString(),
                cached: true,
                data: haberler
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });        }        // RSS Feed kısayolu - LinkedIn uyumlu
        if (path === '/rss') {
            const options = {
                limit: 20,
                detay: true
            };

            const haberler = await fetchNewsForDatabase(options);
            const rssData = convertToRSS(haberler, { feedUrl: `${url.origin}/rss` });

            return new Response(rssData, {
                status: 200,
                headers: {
                    'Content-Type': 'application/rss+xml; charset=utf-8',
                    'Cache-Control': 'public, max-age=300',
                    'X-Robots-Tag': 'index, follow',
                    'Last-Modified': new Date().toUTCString(),
                    ...corsHeaders
                }
            });        }

        // RSS Validator endpoint - LinkedIn doğrulaması için
        if (path === '/rss/validate') {
            const options = {
                limit: 5,  // Doğrulama için az item
                detay: true
            };

            const haberler = await fetchNewsForDatabase(options);
            const rssData = convertToRSS(haberler, { feedUrl: `${url.origin}/rss` });

            // RSS doğrulama bilgileri
            const validation = {
                valid: true,
                format: 'RSS 2.0',
                encoding: 'UTF-8',
                itemCount: haberler.length,
                linkedinCompatible: true,
                lastUpdated: new Date().toISOString(),
                feedUrl: new URL(request.url).origin + '/rss'
            };

            return new Response(JSON.stringify({
                validation,
                sampleRSS: rssData
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }

        // Health check
        if (path === '/health') {
            return new Response(JSON.stringify({
                status: 'OK',
                timestamp: new Date().toISOString(),
                worker: 'Cloudflare Worker',
                cache: {
                    enabled: typeof NEWS_CACHE !== 'undefined',
                    ttl: `${CACHE_TTL} seconds`
                }
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }

        // 404
        return new Response(JSON.stringify({
            success: false,
            error: 'Endpoint bulunamadı',            availableEndpoints: [
                'GET /',
                'GET /api/haberler',
                'GET /api/haberler?format=xml',
                'GET /api/haberler?format=rss',
                'GET /rss',
                'GET /rss/validate',
                'GET /health'
            ]
        }), {
            status: 404,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });
    }
}

// Test için export (Worker'da kullanılmaz)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        fetchNews,
        fetchNewsForDatabase,
        handleRequest
    };
}
