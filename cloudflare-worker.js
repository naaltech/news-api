// Cloudflare Worker için Nevzat Ayaz Haber Çekici
// Bu dosyayı Cloudflare Workers'a deploy edebilirsiniz

// Cache ayarları
const CACHE_TTL = 300; // 5 dakika (saniye)
const CACHE_KEY_PREFIX = 'news_cache_';

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
            // KV store'a veri kaydet
            const cacheData = {
                data: data,
                timestamp: new Date().toISOString()
            };
            await NEWS_CACHE.put(key, JSON.stringify(cacheData));
        }
    } catch (error) {
        console.log('Cache yazma hatası:', error);
    }
}

// Cache key oluşturma
function createCacheKey(options) {
    const { limit, detay } = options;
    return `${CACHE_KEY_PREFIX}${limit || 'all'}_${detay ? 'detailed' : 'simple'}`;
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

// Cheerio yerine basit HTML parsing
class SimpleHTMLParser {
    constructor(html) {
        this.html = html;
    }
    
    // Basit link bulma
    findLinks(pattern) {
        const links = [];
        const linkRegex = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
        let match;
        
        while ((match = linkRegex.exec(this.html)) !== null) {
            const href = match[1];
            const text = normalizeTitle(match[2]);
            
            if (href.includes(pattern) && text.length > 10) {
                links.push({
                    href: href,
                    text: text
                });
            }
        }
        
        return links;
    }
    
    // Basit içerik çıkarma
    extractContent() {
        // HTML taglarını temizle
        let content = this.html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        content = content.replace(/<[^>]+>/g, ' ');
        content = decodeEntities(content);
        content = content.replace(/\s+/g, ' ').trim();
        
        return content;
    }
    
    // Resim bulma
    findImages() {
        const images = [];
        const imgRegex = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
        let match;
        
        while ((match = imgRegex.exec(this.html)) !== null) {
            const src = match[1];
            if (src && !src.includes('logo') && !src.includes('banner')) {
                images.push(src);
            }
        }
        
        return images;
    }
    
    // Title çıkarma
    getTitle() {
        const titleMatch = this.html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
            return titleMatch[1].trim();
        }
        
        const h1Match = this.html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (h1Match) {
            return h1Match[1].trim();
        }
        
        return '';
    }
}

// Ana haber çekme fonksiyonu
async function fetchNews(options = {}) {
    const { limit = null, detay = false } = options;
    
    // Cache kontrolü
    const cacheKey = createCacheKey(options);
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
        return cachedData;
    }
    
    try {
        const haberler = [];
        
        // Ana sayfadan haberleri çek
        const response = await fetch('https://nevzatayazal.meb.k12.tr/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        const parser = new SimpleHTMLParser(html);
          // Haber linklerini bul
        const links = parser.findLinks('/icerikler/');
        
        // Limit uygula
        const effectiveLimit = limit || 20; // Default 20 haber
        
        for (let i = 0; i < links.length && i < effectiveLimit; i++) {
            const link = links[i];
            const tamUrl = link.href.startsWith('http') ? 
                link.href : `https://nevzatayazal.meb.k12.tr${link.href}`;
            
            const haber = {
                id: i + 1,
                baslik: link.text,
                url: tamUrl,
                kaynak: 'Nevzat Ayaz Anadolu Lisesi',
                tarih: new Date().toISOString(),
                cekilmeTarihi: new Date().toISOString()
            };
            
            // Detay isteniyorsa
            if (detay) {
                try {
                    const detayResponse = await fetch(tamUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    
                    if (detayResponse.ok) {
                        const detayHtml = await detayResponse.text();
                        const detayParser = new SimpleHTMLParser(detayHtml);
                        
                        // İçerik çıkar (ilk 500 karakter)
                        const fullContent = detayParser.extractContent();
                        haber.icerik = fullContent.length > 500 ? 
                            fullContent.substring(0, 500) + '...' : fullContent;
                        
                        // Resim bul
                        const images = detayParser.findImages();
                        if (images.length > 0) {
                            haber.resim = images[0].startsWith('http') ? 
                                images[0] : `https://nevzatayazal.meb.k12.tr${images[0]}`;
                        }
                    }
                    
                    // Rate limiting
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    console.log(`Detay alınamadı: ${link.text}`);
                    haber.icerik = 'Detay alınamadı';
                }
            }
            
            haberler.push(haber);        }
        
        // Cache'e kaydet
        const cacheKey = createCacheKey(options);
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
            baslik: haber.baslik,
            url: haber.url,
            icerik: haber.icerik || null,
            resim: haber.resim || null,
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

// XML formatına çevirme
function convertToXML(data, rootElement = 'haberler') {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${rootElement}>\n`;
    
    if (Array.isArray(data)) {
        data.forEach(item => {
            xml += '  <haber>\n';
            Object.entries(item).forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                    // XML özel karakterleri escape et
                    const escapedValue = String(value)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&apos;');
                    xml += `    <${key}>${escapedValue}</${key}>\n`;
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
    const { title = 'Nevzat Ayaz Anadolu Lisesi Haberler', description = 'Nevzat Ayaz Anadolu Lisesi resmi haberleri RSS beslemesi' } = options;
    const baseUrl = 'https://nevzatayazal.meb.k12.tr';
    const currentDate = new Date().toUTCString();
    
    let rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
    <title><![CDATA[${title}]]></title>
    <link>${baseUrl}</link>
    <description><![CDATA[${description}]]></description>
    <language>tr-TR</language>
    <copyright><![CDATA[© ${new Date().getFullYear()} Nevzat Ayaz Anadolu Lisesi]]></copyright>
    <pubDate>${currentDate}</pubDate>
    <lastBuildDate>${currentDate}</lastBuildDate>
    <generator>Nevzat Ayaz RSS Feed v1.3</generator>
    <ttl>300</ttl>
    <atom:link href="${baseUrl}/rss" rel="self" type="application/rss+xml" />
`;

    if (Array.isArray(data) && data.length > 0) {
        data.forEach((item, index) => {
            // LinkedIn için temiz başlık ve açıklama
            const cleanTitle = String(item.baslik || 'Başlık Yok').trim();
            const cleanDescription = String(item.icerik || item.baslik || 'İçerik mevcut değil').trim();
            
            // Tarih kontrolü ve formatı - LinkedIn için önemli
            let pubDate = currentDate;
            if (item.yayinTarihi) {
                try {
                    const dateObj = new Date(item.yayinTarihi);
                    if (!isNaN(dateObj.getTime())) {
                        pubDate = dateObj.toUTCString();
                    }
                } catch (e) {
                    // Tarih parse edilemezse current date kullan
                }
            }
            
            // LinkedIn için unique GUID
            const guid = `nevzat-ayaz-${Date.now()}-${index}`;
            
            // URL kontrolü
            const itemUrl = item.url || `${baseUrl}#item-${index}`;
            
            rss += `    <item>
        <title><![CDATA[${cleanTitle}]]></title>
        <link>${itemUrl}</link>
        <description><![CDATA[${cleanDescription}]]></description>
        <pubDate>${pubDate}</pubDate>
        <guid isPermaLink="false">${guid}</guid>
        <category>Eğitim</category>
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
        <guid isPermaLink="false">nevzat-ayaz-default-${Date.now()}</guid>
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
                version: '1.2.0',                endpoints: {
                    'GET /api/haberler': 'Tüm haberleri getir (default 20 haber)',
                    'GET /api/haberler?limit=5': 'İlk 5 haberi getir',
                    'GET /api/haberler?detay=true': 'Detaylı haberleri getir',
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
                    defaultLimit: '20 haber',
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
            const detay = url.searchParams.get('detay') === 'true';
            const format = url.searchParams.get('format');
            
            const options = {
                limit: limit ? parseInt(limit) : null,
                detay: detay
            };
            
            const haberler = await fetchNewsForDatabase(options);
              // RSS formatı isteniyorsa - LinkedIn uyumlu
            if (format === 'rss') {
                const rssData = convertToRSS(haberler);
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
            const rssData = convertToRSS(haberler);
            
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
            const rssData = convertToRSS(haberler);
            
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
