module.exports = function registerPublicRoutes(app, ctx) {
  const {
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
  } = ctx

  app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard')
    res.render('public/index')
  })

  app.get('/support', (req, res, next) => {

    if (req.session.user) return next()

    setToast(req, 'info', 'Please log in to access support.')

    res.redirect('/login')

  })



  app.get('/about', (req, res) => {
    res.render('public/about')
  })

  app.get('/faq', (req, res) => {
    res.render('public/FAQ')
  })

  app.get('/blog', async (req, res) => {
    const news = await fetchCryptoNews()
    res.render('public/blog', { news })
  })

  app.get('/contact', (req, res) => {
    res.render('public/contact')
  })

  app.get('/feature', (req, res) => {
    res.render('public/feature')
  })

  app.get('/offer', (req, res) => {
    res.render('public/offer')
  })

  app.get('/service', (req, res) => {
    res.render('public/service')
  })

  app.get('/team', (req, res) => {
    res.render('public/team')
  })

  app.get('/testimonial', (req, res) => {
    res.render('public/testimonial')
  })

  app.get('/code', (req, res) => {
    res.render('public/code')
  })

  const legalPages = {
    '/terms': {
      title: 'Terms of Service',
      summary: 'These terms outline the standard conditions for using Kortex Prime account services and trading tools.',
      sections: [
        { title: 'Account Use', body: 'Clients are responsible for maintaining accurate account information and protecting their login credentials. Platform access may be limited when account activity requires review.' },
        { title: 'Trading Activity', body: 'Market products carry risk, and displayed performance or simulated examples do not guarantee future results. Clients should review each transaction before submitting it.' },
        { title: 'Platform Changes', body: 'Kortex Prime may update tools, pricing, disclosures, or account features to keep the service reliable, compliant, and secure.' }
      ]
    },
    '/privacy': {
      title: 'Privacy Policy',
      summary: 'This policy explains how Kortex Prime handles client profile, account, and activity information.',
      sections: [
        { title: 'Information We Collect', body: 'We collect information provided during registration, verification, deposits, withdrawals, support requests, and trading activity.' },
        { title: 'How Information Is Used', body: 'Client information is used to operate accounts, process requests, improve platform security, and send relevant account notifications.' },
        { title: 'Data Protection', body: 'Administrative access should be limited to authorized staff, and sensitive account records should be handled with strong operational controls.' }
      ]
    },
    '/privacy-policy': null,
    '/risk-disclosure': {
      title: 'Risk Disclosure',
      summary: 'Trading stocks, digital assets, and copy-trading products involves risk and may not be suitable for every client.',
      sections: [
        { title: 'Market Risk', body: 'Prices can move quickly due to liquidity, volatility, news, and broader market conditions. Clients may lose part or all of their invested capital.' },
        { title: 'Copy Trading Risk', body: 'Following a trader does not remove risk. Past performance, rankings, or profit history should not be treated as a guarantee.' },
        { title: 'Client Responsibility', body: 'Clients should understand the product, review fees and limits, and only trade with funds they can afford to risk.' }
      ]
    },
    '/aml-policy': {
      title: 'AML Policy',
      summary: 'Kortex Prime uses account review and verification workflows to help prevent prohibited financial activity.',
      sections: [
        { title: 'Verification', body: 'Clients may be required to provide identity documents, contact information, and transaction details before account actions are completed.' },
        { title: 'Monitoring', body: 'Deposits, withdrawals, profile changes, and unusual account activity may be reviewed for security and compliance purposes.' },
        { title: 'Restricted Activity', body: 'Accounts connected to fraud, sanctions concerns, identity misuse, or suspicious payment behavior may be delayed, limited, or closed.' }
      ]
    }
  }
  legalPages['/privacy-policy'] = legalPages['/privacy']

  Object.keys(legalPages).forEach(path => {
    app.get(path, (req, res) => {
      res.render('public/legal', { page: legalPages[path] })
    })
  })

}
