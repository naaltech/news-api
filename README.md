![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnews.naal.org.tr%2Fhealth&query=%24.status&label=API%20STATUS&labelColor=545a61&color=bef9c6)
# 🏫 Nevzat Ayaz News API

A Cloudflare Worker API that serves news from the Nevzat Ayaz Anatolian High School website. The news list comes from the JSON endpoint behind the site's "Haberler" page (`/tema/icerik_listele_ajax.php`), and article pages are fetched for the text.

## 📦 Deployment

### 1. Wrangler CLI Installation
```bash
npm install -g wrangler
wrangler login
```

### 2. KV Store
The `NEWS_CACHE` KV namespace and its preview namespace already exist, and their IDs are set in `wrangler.toml`. No setup is needed.

### 3. Deploy
```bash
# Local development (uses the preview KV namespace)
wrangler dev

# Production deploy (news.naal.org.tr)
wrangler deploy
```

## 🎯 API Endpoints

### Base URL  
```
https://news.naal.org.tr
```

### Main Endpoints

| Endpoint | Method | Description | Format |
|----------|--------|-------------|--------|
| `/` | GET | API documentation | JSON |
| `/api/haberler` | GET | News (JSON) | JSON |
| `/api/haberler?format=xml` | GET | News (XML) | XML |
| `/api/haberler?format=rss` | GET | News (RSS) | RSS |
| `/rss` | GET | RSS shortcut (for LinkedIn) | RSS |
| `/rss/validate` | GET | RSS validation | JSON |
| `/health` | GET | System status | JSON |

### RSS LinkedIn Usage

**RSS URL:**
```
https://news.naal.org.tr/rss
```

**Adding to LinkedIn:**
1. LinkedIn profile → "Add profile section" → "Featured"
2. Select "External link"
3. Add your RSS URL
4. LinkedIn cache updates within 24 hours

### Parameters

- **format** (string): Output format (`json`, `xml`, `rss`)
- **limit** (int): Number of news items (default: 20, max: 40)
- **detay** (boolean): Fetch article pages for the text (default: `true`; `?detay=false` returns a faster list without `icerik`)

### Example Usage

```bash
# JSON API (default)
curl "https://news.naal.org.tr/api/haberler"

# XML format
curl "https://news.naal.org.tr/api/haberler?format=xml"

# RSS feed (for LinkedIn)
curl "https://news.naal.org.tr/rss"

# RSS validation
curl "https://news.naal.org.tr/rss/validate"

# System status
curl "https://news.naal.org.tr/health"
```

## 📊 Response Format

```json
{
  "success": true,
  "count": 2,
  "timestamp": "2023-12-01T10:30:00.000Z",
  "cached": true,
  "data": [
    {
      "id": 17803170,
      "baslik": "News title",
      "url": "https://nevzatayazal.meb.k12.tr/icerikler/...",
      "icerik": "News content details...",
      "resim": "https://nevzatayazal.meb.k12.tr/meb_iys_dosyalar/.../image.jpg",
      "kaynak": "Nevzat Ayaz Anadolu Lisesi",
      "yayinTarihi": "2023-12-01T07:30:00.000Z",
      "cekilmeTarihi": "2023-12-01T10:30:00.000Z",
      "aktif": true,
      "okundu": false
    }
  ]
}
```

### Data Model

Each news object contains the following fields:

- **id** (number): Stable news ID from the school site
- **baslik** (string): News title
- **url** (string): Full URL of the news article, photo gallery or PDF
- **icerik** (string|null): First 500 characters of the article text; `null` for photo galleries and PDF announcements, which have no text
- **resim** (string|null): Cover image URL
- **kaynak** (string): "Nevzat Ayaz Anadolu Lisesi"
- **yayinTarihi** (string): ISO publish date (with the time when the article page shows one)
- **cekilmeTarihi** (string): Data scraping date
- **aktif** (boolean): true
- **okundu** (boolean): false

## ⚡ Cache System

- **TTL**: 5 minutes (300 seconds)
- **Storage**: Cloudflare KV Store
- **Keys**: `news_cache_{limit}_{detay_level}`, expiring after the TTL

### Cache Benefits

- ✅ Fast response (reading from KV)
- ✅ Rate limiting protection  
- ✅ Resource savings
- ✅ Reduced site load

## 🛠️ Development

### Local Testing

To test the Worker code locally:

```bash
# Development server
wrangler dev

# Test endpoints
curl "http://localhost:8787/api/haberler"
```

### Error Handling

The API returns errors in this format:

```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "2023-12-01T10:30:00.000Z"
}
```

### Logs

For Worker logs:

```bash
wrangler tail
```

## 📝 Notes

- 🌐 **Rate Limiting**: Article pages are fetched five at a time to keep the load on the school site low
- 🔄 **Site Changes**: Updates needed if the list endpoint or the article HTML (`#vlightbox1`, `og:image`) changes

## 📜 License

MIT License - See LICENSE file for details.


