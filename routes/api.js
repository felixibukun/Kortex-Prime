module.exports = function registerApiRoutes(app, ctx) {
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

  // API ENDPOINTS
  // ===========================
  app.get('/api/stocks', (req, res) => {
    try {
      const stocks = loadJson('./database/stocks.json', [])
      res.json(stocks)
    } catch (e) {
      res.status(500).json({ error: 'Failed to load stocks' })
    }
  })

  app.get('/api/user/stats', requireLogin, (req, res) => {
    try {
      const stats = calculateUserFinancialStats(req.session.user.id)
      res.json(stats)
    } catch (e) {
      res.status(500).json({ error: 'Failed to load user stats' })
    }
  })

  // ===========================

}
