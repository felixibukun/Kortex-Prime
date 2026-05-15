const dotenv = require('dotenv')
dotenv.config()
const express = require('express')
const path = require('path')
const session = require('express-session')
const fs = require('fs')
const multer = require('multer')
const rateLimit = require('express-rate-limit')
const nodemailer = require('nodemailer')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const cookieParser = require('cookie-parser')
const axios = require('axios')

const app = express()
const isProduction = process.env.NODE_ENV === 'production'
const DEFAULT_ADMIN_PASSWORD = 'Admin999'
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24
const SMARTSUPP_CHAT_SNIPPET = `
<!-- Smartsupp Live Chat script -->
<script type="text/javascript">
var _smartsupp = _smartsupp || {};
_smartsupp.key = '353697866e90d3610b3fdd4ed098d6c5ef5481b4';
window.smartsupp||(function(d) {
  var s,c,o=smartsupp=function(){ o._.push(arguments)};o._=[];
  s=d.getElementsByTagName('script')[0];c=d.createElement('script');
  c.type='text/javascript';c.charset='utf-8';c.async=true;
  c.src='https://www.smartsuppchat.com/loader.js?';s.parentNode.insertBefore(c,s);
})(document);
</script>
<noscript>Powered by <a href="https://www.smartsupp.com" target="_blank">Smartsupp</a></noscript>`
const FAVICON_SNIPPET = `
<link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png?v=20260509">
<link rel="icon" type="image/png" sizes="192x192" href="/img/favicon-192.png?v=20260509">
<link rel="shortcut icon" href="/favicon.ico?v=20260509">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png?v=20260509">`

// ===========================
// CONFIGURATION
// ===========================
const smtpHost = process.env.SMTP_HOST || null
const smtpPort = Number(process.env.SMTP_PORT || 587)
const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || smtpPort === 465
const mailUser = process.env.SMTP_USER || process.env.MAIL_USER || 'globalequinoxtrade@gmail.com'
const mailPass = (process.env.SMTP_PASS || process.env.MAIL_PASS || '').replace(/\s+/g, '')
const mailFrom = process.env.MAIL_FROM_EMAIL
  ? `"${process.env.MAIL_FROM_NAME || process.env.APP_NAME || 'Kortex Prime'}" <${process.env.MAIL_FROM_EMAIL}>`
  : (process.env.MAIL_FROM || mailUser)

const mailerOptions = smtpHost ? {
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  name: process.env.SMTP_CLIENT_NAME || 'localhost',
  connectionTimeout: Number(process.env.SMTP_TIMEOUT_MS || 20000),
  greetingTimeout: Number(process.env.SMTP_TIMEOUT_MS || 20000),
  socketTimeout: Number(process.env.SMTP_TIMEOUT_MS || 20000),
  tls: {
    rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false'
  },
  auth: {
    user: mailUser,
    pass: mailPass
  }
} : {
  service: 'gmail',
  auth: {
    user: mailUser,
    pass: mailPass
  }
}

const mailer = nodemailer.createTransport(mailerOptions)

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many login attempts, please try again later.'
})

const adminLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many admin login attempts, please try again later.'
})

const uploadDir = path.join(__dirname, 'public', 'uploads')
const sessionDir = path.join(__dirname, 'data', 'sessions')
const equityHistoryPath = path.join(__dirname, 'data', 'equityHistory.json')
const verifyFile = './database/emailVerify.json'
const adminLogFile = './database/adminLogs.json'

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true })
}

class JsonSessionStore extends session.Store {
  constructor(options = {}) {
    super()
    this.dir = options.dir
    this.ttl = options.ttl
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60 * 60 * 1000)
    this.cleanupInterval.unref?.()
    this.cleanupExpired()
  }

  filePath(sid) {
    const safeSid = crypto.createHash('sha256').update(String(sid)).digest('hex')
    return path.join(this.dir, `${safeSid}.json`)
  }

  get(sid, callback) {
    fs.readFile(this.filePath(sid), 'utf8', (error, raw) => {
      if (error) {
        return callback(error.code === 'ENOENT' ? null : error)
      }

      try {
        const record = JSON.parse(raw)
        if (record.expiresAt && record.expiresAt <= Date.now()) {
          return this.destroy(sid, () => callback(null, null))
        }
        callback(null, record.session)
      } catch (parseError) {
        callback(parseError)
      }
    })
  }

  set(sid, sess, callback = () => {}) {
    const expiresAt = sess.cookie?.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + this.ttl
    const record = JSON.stringify({ expiresAt, session: sess })
    fs.writeFile(this.filePath(sid), record, callback)
  }

  destroy(sid, callback = () => {}) {
    fs.unlink(this.filePath(sid), error => {
      callback(error && error.code !== 'ENOENT' ? error : null)
    })
  }

  touch(sid, sess, callback = () => {}) {
    this.set(sid, sess, callback)
  }

  cleanupExpired() {
    fs.readdir(this.dir, (error, files) => {
      if (error) return

      files
        .filter(file => file.endsWith('.json'))
        .forEach(file => {
          const filePath = path.join(this.dir, file)
          fs.readFile(filePath, 'utf8', (readError, raw) => {
            if (readError) return
            try {
              const record = JSON.parse(raw)
              if (record.expiresAt && record.expiresAt <= Date.now()) {
                fs.unlink(filePath, () => {})
              }
            } catch {
              fs.unlink(filePath, () => {})
            }
          })
        })
    })
  }
}

const sessionStore = new JsonSessionStore({
  dir: sessionDir,
  ttl: SESSION_MAX_AGE_MS
})

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir)
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '')
    const base = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, base + ext)
  }
})

function fileFilter(req, file, cb) {
  const allowed = ['image/png', 'image/jpeg']
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error('Invalid file type'))
  }
  cb(null, true)
}

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }
})

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, 'public')))
app.use('/temp', express.static(path.join(__dirname, 'temp')))

app.set('trust proxy', 1)

// FIX #3: Use a persistent SESSION_SECRET - never fall back to random bytes
if (!process.env.SESSION_SECRET) {
  console.error('WARNING: SESSION_SECRET is not set in environment variables!')
  console.error('Sessions will not persist across restarts. Set SESSION_SECRET in your .env file.')
  process.exit(1)
}

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.COOKIE_SECURE
        ? String(process.env.COOKIE_SECURE).toLowerCase() === 'true'
        : 'auto',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS
    },
    name: 'sessionId',
    rolling: true
  })
)

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

app.use((req, res, next) => {
  const originalSend = res.send.bind(res)

  res.send = function sendWithSmartsupp(body) {
    if (
      typeof body === 'string' &&
      body.includes('</head>') &&
      !body.includes('/img/favicon-32.png') &&
      !body.includes('/favicon.ico')
    ) {
      body = body.replace('</head>', `${FAVICON_SNIPPET}\n</head>`)
    }

    if (
      !req.path.startsWith('/admin') &&
      typeof body === 'string' &&
      body.includes('</body>') &&
      body.includes('</html>') &&
      !body.includes('smartsuppchat.com/loader.js')
    ) {
      body = body.replace('</body>', `${SMARTSUPP_CHAT_SNIPPET}\n</body>`)
    }

    return originalSend(body)
  }

  next()
})

app.use((req, res, next) => {
  res.locals.toast = req.session.toast || null
  delete req.session.toast
  next()
})

// ===========================
// UTILITY FUNCTIONS
// ===========================
function setToast(req, type, message) {
  req.session.toast = { type, message }
}

function loadJson(filePath, fallback) {
  const backupPath = filePath + '.backup'

  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    if (!raw.trim()) {
      return fallback
    }

    try {
      const parsed = JSON.parse(raw)
      fs.copyFileSync(filePath, backupPath)
      return parsed
    } catch (parseError) {
      console.error(`JSON parse error in ${filePath}:`, parseError)
      try {
        if (fs.existsSync(backupPath)) {
          const backupData = fs.readFileSync(backupPath, 'utf8')
          const parsedBackup = JSON.parse(backupData)
          console.log(`Recovered ${filePath} from backup`)
          return parsedBackup
        }
      } catch (backupError) {
        console.error(`Backup recovery failed for ${filePath}:`, backupError)
      }
      
      const fixed = raw.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/'/g, '"')
      try {
        const recovered = JSON.parse(fixed)
        saveJson(filePath, recovered)
        console.log(`Recovered ${filePath} by fixing JSON`)
        return recovered
      } catch (recoveryError) {
        console.error(`JSON recovery failed for ${filePath}:`, recoveryError)
        return fallback
      }
    }
  } catch (readError) {
    console.error(`Error reading ${filePath}:`, readError)
    if (fs.existsSync(backupPath)) {
      try {
        const backupData = fs.readFileSync(backupPath, 'utf8')
        const parsedBackup = JSON.parse(backupData)
        fs.writeFileSync(filePath, backupData)
        console.log(`Restored ${filePath} from backup after read error`)
        return parsedBackup
      } catch (backupError) {
        console.error(`Backup restoration failed for ${filePath}:`, backupError)
      }
    }
    return fallback
  }
}

function saveJson(filePath, data) {
  const backupPath = filePath + '.backup'
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`

  try {
    const jsonString = JSON.stringify(data, null, 2)
    fs.writeFileSync(tempPath, jsonString)
    const verifyData = fs.readFileSync(tempPath, 'utf8')
    JSON.parse(verifyData)
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath)
    }
    fs.renameSync(tempPath, filePath)
    return true
  } catch (error) {
    console.error(`Error saving ${filePath}:`, error)
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath)
      } catch (cleanupError) {
        console.error(`Failed to remove temp JSON file ${tempPath}:`, cleanupError)
      }
    }
    if (fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, filePath)
        console.log(`Restored ${filePath} from backup after save error`)
      } catch (restoreError) {
        console.error(`Failed to restore ${filePath} from backup:`, restoreError)
      }
    }
    return false
  }
}

// Database loading functions
function loadUsers() {
  return loadJson('./database/users.json', [])
}

function saveUsers(data) {
  saveJson('./database/users.json', data)
}

function loadAdmins() {
  return loadJson('./database/admins.json', [])
}

function saveAdmins(data) {
  saveJson('./database/admins.json', data)
}

function loadAdminLogs() {
  return loadJson(adminLogFile, [])
}

function saveAdminLogs(data) {
  saveJson(adminLogFile, data)
}

// FIX #7: loadEquity now uses the safe loadJson with backup/recovery
function loadEquity() {
  return loadJson(equityHistoryPath, [])
}

function saveEquity(data) {
  saveJson(equityHistoryPath, data)
}

function loadVerify() {
  return loadJson(verifyFile, [])
}

function saveVerify(data) {
  saveJson(verifyFile, data)
}

function logAdminAction(req, action, meta) {
  try {
    const logs = loadAdminLogs()
    logs.push({
      id: Date.now(),
      adminId: req.session.admin ? req.session.admin.id : null,
      action,
      meta,
      timestamp: new Date().toISOString(),
      ip: req.ip
    })
    saveAdminLogs(logs)
  } catch (e) {
    console.error('Admin log error:', e)
  }
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for']
  if (xf) return xf.split(',')[0].trim()
  return req.ip || req.connection.remoteAddress
}

// ===========================
// EMAIL FUNCTIONS
// ===========================
async function notify(email, subject, message) {
  try {
    if (!email) return null

    let body = ''
    let text = ''
    const lower = (subject || '').toLowerCase()
    const brand = process.env.APP_NAME || 'Kortex Prime'
    const safeSubject = escapeHtml(subject || brand)
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`
    const hasPublicAppUrl = /^https?:\/\//i.test(appUrl) && !/localhost|127\.0\.0\.1/i.test(appUrl)
    const safeMessage = String(message || '')

    function wrap(msg) {
      return `<p style="color:#1f2937; font-size:15px; margin:6px 0; line-height:1.6;">${escapeHtml(msg || '')}</p>`
    }

    function shell(title, subtitle, footer) {
      text = [
        `${brand}: ${title}`,
        '',
        subtitle,
        '',
        safeMessage,
        '',
        footer,
        '',
        hasPublicAppUrl ? `Open your dashboard: ${appUrl}/dashboard` : '',
        '',
        `Sent by ${brand}.`
      ].filter(Boolean).join('\n')

      return `
      <div style="background:#f3f4f6; padding:28px 16px; font-family:Arial,Helvetica,sans-serif; color:#1f2937;">
        <div style="max-width:600px; margin:auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">
          <div style="padding:24px 26px; border-bottom:1px solid #e5e7eb;">
            <p style="font-size:13px; color:#2563eb; font-weight:700; margin:0 0 10px;">${escapeHtml(brand)}</p>
            <h1 style="font-size:22px; line-height:1.25; color:#111827; margin:0 0 8px;">${escapeHtml(title)}</h1>
            <p style="font-size:15px; line-height:1.6; color:#4b5563; margin:0;">${escapeHtml(subtitle)}</p>
          </div>
          <div style="padding:26px;">
            <div style="background:#f9fafb; padding:18px; border-radius:10px; border:1px solid #e5e7eb;">
              <p style="margin:0 0 8px; color:#374151; font-size:13px; font-weight:700;">Activity summary</p>
              ${wrap(message)}
            </div>
            <p style="margin:18px 0 0; color:#4b5563; font-size:14px; line-height:1.6;">Time: ${new Date().toLocaleString()}</p>
            ${hasPublicAppUrl ? `<div style="margin-top:22px;">
              <a href="${escapeHtml(appUrl)}/dashboard" style="display:inline-block; background:#2563eb; color:#ffffff; text-decoration:none; padding:11px 18px; border-radius:8px; font-size:14px; font-weight:700;">Open dashboard</a>
            </div>` : ''}
            <p style="color:#6b7280; font-size:12px; margin:24px 0 0; line-height:18px;">
              ${escapeHtml(footer)}
            </p>
          </div>
        </div>
        <p style="max-width:600px; margin:14px auto 0; color:#6b7280; font-size:11px; line-height:1.6; text-align:center;">
          This email was sent by ${escapeHtml(brand)} for account notifications.
        </p>
      </div>`
    }

    if (lower.includes('verify')) {
      body = shell('Email Verification', 'Complete your account setup', 'You received this message because an account action was requested.')
    } else if (lower.includes('trade executed') || lower.includes('copy trader')) {
      body = shell('Trade Activity', 'Your trading activity has been updated', 'Check your dashboard for full trade details and updated totals.')
    } else if (lower.includes('deposit')) {
      body = shell('Deposit Update', 'Your deposit status has changed', 'Once approved, your total deposit and deposit history will update in your account.')
    } else if (lower.includes('withdrawal')) {
      body = shell('Withdrawal Update', 'Your withdrawal status has changed', 'Processing times depend on network and payment provider.')
    } else if (lower.includes('package')) {
      body = shell('Package Update', 'Your package activity was updated', 'Review package history from your dashboard for the latest status.')
    } else if (lower.includes('kyc')) {
      body = shell('Verification Update', 'Your account verification status has changed', 'Verification reviews help keep your account secure and compliant.')
    } else if (lower.includes('profile') || lower.includes('account') || lower.includes('sign-in') || lower.includes('login')) {
      body = shell('Account Update', 'A secure account activity was recorded', 'If this was not you, contact support immediately.')
    } else {
      body = shell(subject || brand, 'Account notification', `This is an automated message from ${brand}.`)
    }

    const logoPath = path.join(__dirname, 'public', 'img', 'logo.png')
    const mailOptions = {
      from: mailFrom,
      sender: mailUser,
      replyTo: process.env.MAIL_REPLY_TO || mailFrom,
      to: email,
      subject: subject,
      text,
      html: body,
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All'
      }
    }

    if (process.env.MAIL_ATTACH_LOGO === 'true' && fs.existsSync(logoPath)) {
      mailOptions.attachments = [
        {
          filename: 'logo.png',
          path: logoPath,
          cid: 'klogo'
        }
      ]
    }

    return await mailer.sendMail(mailOptions)
  } catch (e) {
    console.error('Email error:', e)
    throw e
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function money(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function notifyActivity(user, subject, message) {
  if (!user || !user.email) return
  try {
    await notify(user.email, subject, message)
  } catch (e) {
    console.error(`Email notify error (${subject || 'activity'}):`, e.message || e)
  }
}

// ===========================
// FIX #2: REAL MARKET DATA - now fetches live prices via API
// ===========================
async function getRealMarketData() {
  try {
    // Fetch crypto prices from CoinGecko (free, no API key needed)
    const cryptoRes = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano,dogecoin&vs_currencies=usd&include_24hr_change=true',
      { timeout: 5000 }
    )
    const crypto = cryptoRes.data

    // Check if stock market is open (Mon–Fri, 9am–5pm ET roughly)
    const now = new Date()
    const day = now.getDay()
    const hour = now.getHours()
    const marketOpen = (day >= 1 && day <= 5) && (hour >= 9 && hour < 17)

    return {
      btcPrice: crypto.bitcoin?.usd ?? 67432.15,
      btcChange: crypto.bitcoin?.usd_24h_change?.toFixed(2) ?? 2.34,
      ethPrice: crypto.ethereum?.usd ?? 3542.78,
      ethChange: crypto.ethereum?.usd_24h_change?.toFixed(2) ?? 1.85,
      solPrice: crypto.solana?.usd ?? 172.45,
      solChange: crypto.solana?.usd_24h_change?.toFixed(2) ?? 5.67,
      adaPrice: crypto.cardano?.usd ?? 0.62,
      adaChange: crypto.cardano?.usd_24h_change?.toFixed(2) ?? 0.85,
      dogePrice: crypto.dogecoin?.usd ?? 0.15,
      dogeChange: crypto.dogecoin?.usd_24h_change?.toFixed(2) ?? 0.5,
      // Stock index prices: static fallback (requires paid API for live data)
      sp500Price: 5201.34,
      nasdaqPrice: 16302.76,
      dowjonesPrice: 38852.27,
      marketOpen
    }
  } catch (error) {
    console.error('Market data fetch error:', error.message)
    // Fallback to static data if API fails
    return {
      btcPrice: 67432.15,
      btcChange: 2.34,
      ethPrice: 3542.78,
      ethChange: 1.85,
      solPrice: 172.45,
      solChange: 5.67,
      adaPrice: 0.62,
      adaChange: 0.85,
      dogePrice: 0.15,
      dogeChange: 0.5,
      sp500Price: 5201.34,
      nasdaqPrice: 16302.76,
      dowjonesPrice: 38852.27,
      marketOpen: true
    }
  }
}

const cryptoNewsFeeds = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' }
]

let cryptoNewsCache = {
  items: [],
  updatedAt: null,
  expiresAt: 0
}

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripHtml(value = '') {
  return decodeXml(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function getXmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? decodeXml(match[1]).trim() : ''
}

function parseRssItems(xml, source) {
  const blocks = String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || []
  return blocks.map(block => {
    const title = stripHtml(getXmlTag(block, 'title'))
    const link = stripHtml(getXmlTag(block, 'link'))
    const pubDateRaw = stripHtml(getXmlTag(block, 'pubDate') || getXmlTag(block, 'dc:date'))
    const description = stripHtml(getXmlTag(block, 'description') || getXmlTag(block, 'content:encoded'))
    const publishedAt = pubDateRaw ? new Date(pubDateRaw) : null

    return {
      source,
      title,
      link,
      description: description.length > 180 ? `${description.slice(0, 177)}...` : description,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt.toISOString() : null
    }
  }).filter(item => item.title && item.link)
}

async function fetchCryptoNews() {
  const now = Date.now()
  if (cryptoNewsCache.items.length && cryptoNewsCache.expiresAt > now) {
    return cryptoNewsCache
  }

  const results = await Promise.allSettled(
    cryptoNewsFeeds.map(async feed => {
      const response = await axios.get(feed.url, {
        timeout: 8000,
        headers: {
          'User-Agent': 'KortexPrime/1.0 (+https://localhost:3000)'
        }
      })
      return parseRssItems(response.data, feed.name)
    })
  )

  const items = results
    .flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, 12)

  if (items.length) {
    cryptoNewsCache = {
      items,
      updatedAt: new Date().toISOString(),
      expiresAt: now + (15 * 60 * 1000)
    }
  }

  return cryptoNewsCache.items.length
    ? cryptoNewsCache
    : {
        items: [
          {
            source: 'Kortex Prime Market Desk',
            title: 'Crypto market feed temporarily unavailable',
            link: '/contact',
            description: 'Live headlines could not be loaded right now. Please refresh shortly; the page automatically retries the public crypto news feeds.',
            publishedAt: new Date().toISOString()
          }
        ],
        updatedAt: new Date().toISOString(),
        expiresAt: now + (5 * 60 * 1000)
      }
}

function calculateUserFinancialStats(userId) {
  const users = loadUsers()
  const user = users.find(u => u.id === userId)
  const withdrawals = loadJson('./database/withdrawals.json', [])
  const deposits = loadJson('./database/deposits.json', [])
  const trades = loadJson('./database/trades.json', [])

  if (!user) return null

  // Spendable deposit wallet. Purchases deduct from this value.
  const totalDeposit = Number(user.deposit || 0)

  // Total from approved withdrawals only
  const approvedWithdrawals = withdrawals.filter(w => w.userId === userId && w.status === 'approved')
  const totalWithdrawal = approvedWithdrawals.reduce((sum, w) => sum + Number(w.amount), 0)

  // Use the user's profit wallet as the source of truth because admins and
  // completed sells write there. Fall back to trade history for older records.
  const userTrades = trades.filter(t => t.userId === userId)
  const tradeProfit = userTrades.reduce((sum, t) => sum + Number(t.profit || 0), 0)
  const storedProfit = Number(user.profit || 0)
  const totalProfit = storedProfit !== 0 ? storedProfit : tradeProfit

  // FIX #9: Net profit = profit from trades only (withdrawals come from balance, not profit)
  const netProfit = totalProfit

  // Win rate
  const winningTrades = userTrades.filter(t => Number(t.profit) > 0).length
  const winRate = userTrades.length > 0 ? ((winningTrades / userTrades.length) * 100).toFixed(1) : '0.0'

  const following = loadJson('./database/following.json', [])
  const activeTrades = following.filter(f => f.userId === userId && f.status !== 'closed').length

  return {
    totalDeposit,
    totalBalance: Number(user.balance || 0),
    bonus: Number(user.bonus || 0),
    totalProfit,
    totalWithdrawal,
    netProfit,
    referralBonus: Number(user.referralBonus || 0),
    activeTrades,
    winRate,
    portfolioValue: Number(user.balance || 0) + Number(user.deposit || 0) + totalProfit
  }
}

function generatePerformanceData(startValue = 10000, duration = 30) {
  const data = []
  let currentValue = startValue

  for (let i = 0; i < duration; i++) {
    const dailyChange = (Math.random() * 0.06 - 0.03)
    currentValue *= (1 + dailyChange)
    if (i > duration * 0.3) currentValue *= 1.001
    data.push(Math.round(currentValue))
  }

  return data
}

// ===========================
// MIDDLEWARE
// ===========================
function requireLogin(req, res, next) {
  if (!req.session.user) {
    console.log('Access denied: No user session')
    return res.redirect('/login')
  }
  next()
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    console.log('Admin access denied: No admin session')
    return res.redirect('/admin-login')
  }
  next()
}

// FIX #8: Admin IP restriction now actually enforces allowed IPs
function requireAdminIP(req, res, next) {
  const allowedIPs = process.env.ADMIN_ALLOWED_IPS
    ? process.env.ADMIN_ALLOWED_IPS.split(',').map(ip => ip.trim())
    : null

  // If no IPs configured, skip restriction (but log a warning)
  if (!allowedIPs || allowedIPs.length === 0) {
    console.warn('WARNING: ADMIN_ALLOWED_IPS is not configured. Admin panel is accessible from any IP.')
    return next()
  }

  const clientIp = getClientIp(req)
  if (!allowedIPs.includes(clientIp)) {
    console.warn(`Admin access blocked from IP: ${clientIp}`)
    logAdminAction(req, 'blocked_ip_access', { ip: clientIp })
      return res.status(403).render('system/404', {
      user: req.session.user,
      currentPath: req.path
    })
  }

  next()
}

// ===========================
// LIVE DATA SIMULATION
// ===========================
if (process.env.ENABLE_STOCK_SIMULATION === 'true') {
  setInterval(() => {
    try {
      const stocks = loadJson('./database/stocks.json', [])
      let changed = false
      if (stocks && stocks.length > 0) {
        stocks.forEach(s => {
          const change = (Math.random() * 2 - 1).toFixed(2)
          let newPrice = s.price + Number(change)
          if (newPrice < 1) newPrice = 1
          if (s.price !== Number(newPrice.toFixed(2))) {
            s.price = Number(newPrice.toFixed(2))
            changed = true
          }
        })
        if (changed) {
          saveJson('./database/stocks.json', stocks)
        }
      }
    } catch (e) {
      console.error('Stock update error:', e)
    }
  }, 10000)
}

// ===========================
// AUTHENTICATION ROUTES
// ===========================
// ===========================
// ROUTES
// ===========================
const routeContext = {
  authLimit,
  adminLimit,
  upload,
  requireLogin,
  requireAdmin,
  requireAdminIP,
  setToast,
  loadJson,
  saveJson,
  loadUsers,
  saveUsers,
  loadAdmins,
  saveAdmins,
  loadAdminLogs,
  saveAdminLogs,
  loadEquity,
  saveEquity,
  loadVerify,
  saveVerify,
  logAdminAction,
  getClientIp,
  notify,
  notifyActivity,
  getRealMarketData,
  fetchCryptoNews,
  calculateUserFinancialStats,
  generatePerformanceData,
  money,
  bcrypt,
  crypto,
  fs,
  path
}

require('./routes/public')(app, routeContext)
require('./routes/auth')(app, routeContext)
require('./routes/user')(app, routeContext)
require('./routes/api')(app, routeContext)
require('./routes/admin')(app, routeContext)
if (process.env.ENABLE_TEST_EMAIL_ROUTE === 'true') {
  require('./routes/test-email')(app, routeContext)
}

// ERROR HANDLING
// ===========================
app.use((err, req, res, next) => {
  if (err && (err.message === 'Invalid file type' || err.code === 'LIMIT_FILE_SIZE')) {
    setToast(req, 'error', 'Invalid or too large file')
    return res.redirect('back')
  }
  console.error('Unhandled error:', err)
  next(err)
})

app.use((req, res) => {
  res.status(404).render('system/404', {
    user: req.session.user,
    currentPath: req.path
  })
})

// ===========================
// INITIALIZATION
// ===========================
const PORT = process.env.PORT || 3000

const requiredDirs = ['./database', './public/uploads', './data']
requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
})

const essentialDBs = [
  './database/users.json',
  './database/admins.json',
  './database/deposits.json',
  './database/withdrawals.json',
  './database/kyc.json',
  './database/holdings.json',
  './database/trades.json',
  './database/subscriptions.json',
  './database/stocks.json',
  './database/copytraders.json',
  './database/following.json',
  './database/depositMethods.json',
  './database/paymentInstructions.json',
  './database/emailVerify.json',
  './database/adminLogs.json'
]

essentialDBs.forEach(db => {
  if (!fs.existsSync(db)) {
    let initialData = []

    if (db.includes('stocks.json')) {
      initialData = [
        { id: 1, symbol: 'AAPL', name: 'Apple Inc.', price: 175.25, change24h: 1.34, volume: 10000000 },
        { id: 2, symbol: 'GOOGL', name: 'Alphabet Inc.', price: 150.45, change24h: 0.85, volume: 8000000 },
        { id: 3, symbol: 'TSLA', name: 'Tesla Inc.', price: 172.63, change24h: -0.45, volume: 12000000 },
        { id: 4, symbol: 'MSFT', name: 'Microsoft Corp.', price: 420.15, change24h: 2.15, volume: 9000000 },
        { id: 5, symbol: 'AMZN', name: 'Amazon.com Inc.', price: 178.90, change24h: 0.75, volume: 11000000 }
      ]
    } else if (db.includes('copytraders.json')) {
      initialData = [
        { id: 1, name: 'John Trader', winRate: 78, totalProfit: 125000, followers: 1250 },
        { id: 2, name: 'Sarah Investor', winRate: 85, totalProfit: 89000, followers: 980 },
        { id: 3, name: 'Mike Analyst', winRate: 72, totalProfit: 156000, followers: 2100 }
      ]
    } else if (db.includes('depositMethods.json')) {
      initialData = [
        { id: 1, name: 'Bank Transfer', enabled: true, wallet: 'Bank transfer details here' },
        { id: 2, name: 'Credit Card', enabled: true, wallet: 'Credit card processing' },
        { id: 3, name: 'Cryptocurrency', enabled: true, wallet: 'BTC: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
        { id: 4, name: 'PayPal', enabled: true, wallet: 'paypal@example.com' }
      ]
    } else if (db.includes('paymentInstructions.json')) {
      initialData = {}
    }

    fs.writeFileSync(db, JSON.stringify(initialData, null, 2))
    console.log(`Created missing database: ${db}`)
  }
})

async function initializeAndStart() {
  try {
    const admins = loadAdmins()
    let needsSave = false

    for (const admin of admins) {
      if (admin.password && !admin.password.startsWith('$2')) {
        admin.password = await bcrypt.hash(admin.password, 12)
        needsSave = true
      } else if (isProduction && admin.password && await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, admin.password)) {
        console.error('Production startup blocked: default admin password is still active.')
        console.error('Change the admin password before launching.')
        process.exit(1)
      }
    }

    if (needsSave) {
      saveAdmins(admins)
      console.log('Admin passwords have been hashed for security')
    }

    if (admins.length === 0) {
      if (isProduction) {
        console.error('Production startup blocked: no admin account exists.')
        console.error('Create an admin account before launching.')
        process.exit(1)
      }

      const defaultPassword = DEFAULT_ADMIN_PASSWORD
      const hashedPassword = await bcrypt.hash(defaultPassword, 12)
      const adminUser = {
        id: Date.now(),
        username: 'admin',
        name: 'Administrator',
        email: 'admin@example.com',
        password: hashedPassword,
        createdAt: new Date().toISOString()
      }

      admins.push(adminUser)
      saveAdmins(admins)

      console.log('======================================')
      console.log('DEFAULT ADMIN CREATED')
      console.log('Username: admin')
      console.log('Password: Admin999')
      console.log('CHANGE THIS PASSWORD IMMEDIATELY')
      console.log('======================================\n')
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`)
      console.log(`Dashboard: http://localhost:${PORT}/dashboard`)
      console.log(`Admin panel: http://localhost:${PORT}/admin-login`)
    })
  } catch (error) {
    console.error('Initialization error:', error)
    process.exit(1)
  }
}

initializeAndStart()
