![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnews.naal.org.tr%2Fhealth&query=%24.status&label=API%20STATUS&labelColor=545a61&color=bef9c6)
# 🏫 Nevzat Ayaz News API

A Cloudflare Worker API that scrapes news from Nevzat Ayaz Anatolian High School website.

## 📦 Deployment

### 1. Wrangler CLI Installation
```bash
npm install -g wrangler
wrangler login
```

### 2. Create KV Store
```bash
# Create production KV namespace
wrangler kv:namespace create "NEWS_CACHE"

# Create preview KV namespace (for development)
wrangler kv:namespace create "NEWS_CACHE" --preview
```

### 3. Update wrangler.toml
Update the KV namespace IDs in your `wrangler.toml` file:
```toml
[[kv_namespaces]]
binding = "NEWS_CACHE"
id = "your-actual-kv-namespace-id"           # get from command above
preview_id = "your-preview-kv-namespace-id"  # get from command above
```

### 4. Deploy
```bash
# Development/Preview deploy
wrangler deploy --env staging

# Production deploy  
wrangler deploy --env production
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
- **limit** (int): Number of news items (default: 20)
- **detay** (boolean): Detailed content (`?detay=true`)

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
      "baslik": "News title",
      "url": "https://nevzatayazal.meb.k12.tr/icerikler/...",
      "icerik": "News content details...",
      "resim": "https://nevzatayazal.meb.k12.tr/image.jpg",
      "kaynak": "Nevzat Ayaz Anadolu Lisesi",
      "yayinTarihi": "2023-12-01T10:30:00.000Z",
      "cekilmeTarihi": "2023-12-01T10:30:00.000Z",
      "aktif": true,
      "okundu": false
    }
  ]
}
```

### Data Model

Each news object contains the following fields:

- **baslik** (string): News title
- **url** (string): Full URL of the news article  
- **icerik** (string|null): News content (if detay=true)
- **resim** (string|null): Main image URL (if detay=true)
- **kaynak** (string): "Nevzat Ayaz Anadolu Lisesi"
- **yayinTarihi** (string): ISO date
- **cekilmeTarihi** (string): Data scraping date
- **aktif** (boolean): true
- **okundu** (boolean): false

## ⚡ Cache System

- **TTL**: 5 minutes (300 seconds)
- **Storage**: Cloudflare KV Store
- **Keys**: `news_cache_{limit}_{detay_level}`
- **Bypass**: Use `?force=true` parameter

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

- 🌐 **Rate Limiting**: Delays included for site protection
- 🔄 **Site Changes**: Updates needed if HTML structure changes
- 💾 **Cache**: Use `?force=true` for fresh data

## 📜 License

MIT License - See LICENSE file for details.


