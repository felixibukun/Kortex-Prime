module.exports = function registerTestEmailRoutes(app, ctx) {
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

  // Test email route
  app.get('/test-email', async (req, res) => {
    try {
      const info = await notify(
        process.env.TEST_EMAIL || 'yourrealemail@gmail.com',
        'Kortex Prime Test Email',
        'Email system working successfully'
      )
      res.send(`Email sent successfully: ${info.messageId}`)
    } catch (e) {
      console.error(e)
      res.status(500).send(`Email failed: ${e.response || e.message || 'Unknown mail error'}`)
    }
  })

}
