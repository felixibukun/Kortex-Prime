module.exports = function registerAdminRoutes(app, ctx) {
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

  function recordTime(record) {
    const raw = record?.createdAt || record?.timestamp || record?.date || record?.subscribedAt || record?.startedAt || record?.updatedAt || record?.approvedAt || record?.rejectedAt || record?.endedAt
    const parsed = raw ? new Date(raw).getTime() : 0
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Number(record?.id || 0)
  }

  function newestFirst(records) {
    return [...(records || [])].sort((a, b) => recordTime(b) - recordTime(a))
  }

  // ADMIN ROUTES
  // ===========================
  app.get('/admin-login', (req, res) => {
    if (req.session.admin) return res.redirect('/admin')
    res.render('admin/admin-login')
  })

  app.get('/admin/profile', requireAdmin, requireAdminIP, (req, res) => {
    res.render('admin/admin-profile', {
      admin: req.session.admin,
      currentPath: '/admin/profile'
    })
  })

  app.get('/admin-profile', requireAdmin, requireAdminIP, (req, res) => {
    res.redirect('/admin/profile')
  })

  app.post('/admin-login', adminLimit, async (req, res) => {
    try {
      const { username, password } = req.body
      const admins = loadAdmins()
      const adminUser = admins.find(a => a.username === username)

      if (!adminUser) {
        console.warn(`Admin login attempt with non-existent username: ${username} from IP: ${getClientIp(req)}`)
        logAdminAction(req, 'failed_admin_login', { username, ip: getClientIp(req) })
        setToast(req, 'error', 'Invalid login')
        return res.redirect('/admin-login')
      }

      let ok = false
      if (adminUser.password && adminUser.password.startsWith('$2')) {
        ok = await bcrypt.compare(password, adminUser.password)
      } else {
        if (adminUser.password === password) {
          ok = true
          req.session.adminRequiresPasswordUpdate = true
        }
      }

      if (!ok) {
        console.warn(`Failed admin login attempt for username: ${username} from IP: ${getClientIp(req)}`)
        logAdminAction(req, 'failed_admin_login', { username, ip: getClientIp(req) })
        setToast(req, 'error', 'Invalid login')
        return res.redirect('/admin-login')
      }

      req.session.admin = {
        id: adminUser.id,
        username: adminUser.username
      }

      req.session.save((err) => {
        if (err) {
          console.error('Admin session save error:', err)
          setToast(req, 'error', 'Admin login error')
          return res.redirect('/admin-login')
        }

        if (req.session.adminRequiresPasswordUpdate) {
          delete req.session.adminRequiresPasswordUpdate
          setToast(req, 'warning', 'Please update your password for security')
          return res.redirect('/admin/profile')
        }

        logAdminAction(req, 'admin_login_success', { username: adminUser.username })
        res.redirect('/admin')
      })
    } catch (e) {
      console.error('Admin login error:', e)
      setToast(req, 'error', 'Admin login error')
      res.redirect('/admin-login')
    }
  })

  app.get('/admin', requireAdmin, requireAdminIP, (req, res) => {
    try {
      const users = newestFirst(loadUsers())
      const withdrawals = newestFirst(loadJson('./database/withdrawals.json', []))
      const deposits = newestFirst(loadJson('./database/deposits.json', []))
      const kycRequests = newestFirst(loadJson('./database/kyc.json', []))
      const pendingWithdrawals = withdrawals.filter(w => String(w.status || '').toLowerCase() === 'pending')
      const pendingKyc = kycRequests.filter(k => String(k.status || '').toLowerCase() === 'pending')
      const pendingCount = pendingWithdrawals.length + pendingKyc.length
      const approvedDepositsTotal = deposits
        .filter(d => String(d.status || '').toLowerCase() === 'approved')
        .reduce((sum, d) => sum + Number(d.amount || 0), 0)

      res.render('admin/admin-dashboard', {
        admin: req.session.admin,
        users,
        withdrawals,
        deposits,
        kycRequests,
        pendingWithdrawals,
        pendingKyc,
        pendingCount,
        approvedDepositsTotal,
        currentPath: '/admin'
      })
    } catch (error) {
      console.error('Admin dashboard error:', error)
      setToast(req, 'error', 'Error loading admin dashboard')
      res.redirect('/admin-login')
    }
  })

  app.get('/admin-logout', (req, res) => {
    logAdminAction(req, 'admin_logout', { username: req.session.admin?.username })
    req.session.destroy((err) => {
      if (err) console.error('Admin logout error:', err)
      res.redirect('/admin-login')
    })
  })

  // ===========================
  // ADMIN PAGE ROUTES
  // ===========================
  app.get('/admin/users', requireAdmin, requireAdminIP, (req, res) => {
    const users = newestFirst(loadUsers())
    res.render('admin/admin-users', {
      admin: req.session.admin,
      users,
      currentPath: '/admin/users'
    })
  })

  app.get('/admin/user/:id', requireAdmin, requireAdminIP, (req, res) => {
    const users = loadUsers()
    const user = users.find(u => u.id === Number(req.params.id))

    if (!user) {
      setToast(req, 'error', 'User not found')
      return res.redirect('/admin/users')
    }

    const financialStats = calculateUserFinancialStats(user.id)
    const holdings = loadJson('./database/holdings.json', []).filter(h => h.userId === user.id)
    const trades = newestFirst(loadJson('./database/trades.json', []).filter(t => t.userId === user.id))
    const deposits = newestFirst(loadJson('./database/deposits.json', []).filter(d => d.userId === user.id))
    const withdrawals = newestFirst(loadJson('./database/withdrawals.json', []).filter(w => w.userId === user.id))
    const kyc = newestFirst(loadJson('./database/kyc.json', []).filter(k => k.userId === user.id))
    const subscriptions = newestFirst(loadJson('./database/subscriptions.json', []).filter(s => s.userId === user.id))

    res.render('admin/admin-user-details', {
      admin: req.session.admin,
      user,
      financialStats,
      holdings,
      trades,
      deposits,
      withdrawals,
      kyc,
      subscriptions,
      currentPath: '/admin/users'
    })
  })

  app.post('/admin/user/:id/impersonate', requireAdmin, requireAdminIP, (req, res) => {
    const users = loadUsers()
    const user = users.find(u => u.id === Number(req.params.id))

    if (!user) {
      setToast(req, 'error', 'User not found')
      return res.redirect('/admin/users')
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role
    }

    req.session.adminPreview = {
      userId: user.id,
      startedAt: new Date().toISOString()
    }

    

    logAdminAction(req, 'admin_impersonated_user', { userId: user.id, username: user.username })
    req.session.save(() => {
      res.redirect('/dashboard')
    })
  })

  app.get('/admin/stop-impersonation', requireAdmin, requireAdminIP, (req, res) => {
    const userId = req.session.user?.id
    delete req.session.user
    delete req.session.adminPreview

    logAdminAction(req, 'admin_stopped_impersonation', { userId })
    req.session.save(() => {
      res.redirect('/admin/users')
    })
  })

  app.get('/secure/stop-preview', requireAdmin, requireAdminIP, (req, res) => {
    const userId = req.session.user?.id
    delete req.session.user
    delete req.session.adminPreview

    logAdminAction(req, 'secure_preview_ended', { userId })
    req.session.save(() => {
      res.redirect('/admin/users')
    })
  })

  app.get('/admin/user/:id/balance', requireAdmin, requireAdminIP, (req, res) => {
    const users = loadUsers()
    const user = users.find(u => u.id === Number(req.params.id))

    if (!user) {
      setToast(req, 'error', 'User not found')
      return res.redirect('/admin/users')
    }

    res.render('admin/admin-edit-balance', {
      admin: req.session.admin,
      user,
      currentPath: '/admin/users'
    })
  })

  app.post('/admin/user/:id/balance', requireAdmin, requireAdminIP, async (req, res) => {
    try {
      const users = loadUsers()
      const user = users.find(u => u.id === Number(req.params.id))

      if (!user) {
        setToast(req, 'error', 'User not found')
        return res.redirect('/admin/users')
      }

      user.balance = Number(req.body.balance || 0)
      user.profit = Number(req.body.profit || 0)
      user.bonus = Number(req.body.bonus || 0)
      user.deposit = Number(req.body.deposit || 0)

      saveUsers(users)
      logAdminAction(req, 'user_balance_updated', { userId: user.id })
      await notifyActivity(
        user,
        "Account Balance Updated",
        `Your account wallet totals were updated. Current total deposit: ${money(user.deposit)}. Current balance: ${money(user.balance)}. Bonus: ${money(user.bonus)}.`
      )
      setToast(req, 'success', 'User wallet updated')
      res.redirect('/admin/users')
    } catch (error) {
      console.error('Admin balance update error:', error)
      setToast(req, 'error', 'Error updating user wallet')
      res.redirect('/admin/users')
    }
  })

  app.post('/admin/user/:id/password', requireAdmin, requireAdminIP, async (req, res) => {
    try {
      const users = loadUsers()
      const user = users.find(u => u.id === Number(req.params.id))
      const { password } = req.body

      if (!user) {
        setToast(req, 'error', 'User not found')
        return res.redirect('/admin/users')
      }

      if (!password || password.length < 6) {
        setToast(req, 'error', 'Password must be at least 6 characters')
        return res.redirect(`/admin/user/${user.id}`)
      }

      user.password = await bcrypt.hash(password, 12)
      user.passwordUpdatedAt = new Date().toISOString()

      saveUsers(users)
      logAdminAction(req, 'user_password_reset', { userId: user.id, username: user.username })
      await notifyActivity(
        user,
        "Account Password Updated",
        "Your account password was updated. If you did not request this change, contact support immediately."
      )
      setToast(req, 'success', 'User password updated')
      res.redirect(`/admin/user/${user.id}`)
    } catch (error) {
      console.error('Admin password reset error:', error)
      setToast(req, 'error', 'Error updating user password')
      res.redirect(`/admin/user/${req.params.id}`)
    }
  })

  app.post('/admin/user/:id/delete', requireAdmin, requireAdminIP, (req, res) => {
    try {
      const userId = Number(req.params.id)
      const users = loadUsers()
      const user = users.find(u => u.id === userId)

      if (!user) {
        setToast(req, 'error', 'User not found')
        return res.redirect('/admin/users')
      }

      saveUsers(users.filter(u => u.id !== userId))

      const relatedFiles = [
        './database/holdings.json',
        './database/trades.json',
        './database/deposits.json',
        './database/withdrawals.json',
        './database/kyc.json',
        './database/subscriptions.json',
        './database/following.json'
      ]

      relatedFiles.forEach(file => {
        const records = loadJson(file, [])
        saveJson(file, records.filter(record => record.userId !== userId))
      })

      logAdminAction(req, 'user_deleted', { userId, username: user.username })
      setToast(req, 'success', 'User deleted')
      res.redirect('/admin/users')
    } catch (error) {
      console.error('Admin delete user error:', error)
      setToast(req, 'error', 'Error deleting user')
      res.redirect('/admin/users')
    }
  })

  app.get('/admin/packages', requireAdmin, requireAdminIP, (req, res) => {
    const subscriptions = newestFirst(loadJson('./database/subscriptions.json', []))
    const users = loadUsers()

    const packages = subscriptions.map(sub => {
      const user = users.find(u => u.id === sub.userId)
      return {
        ...sub,
        userName: user ? (user.name || user.username) : 'Deleted user',
        userEmail: user ? user.email : 'N/A'
      }
    })

    res.render('admin/admin-packages', {
      admin: req.session.admin,
      packages,
      currentPath: '/admin/packages'
    })
  })

  app.get('/admin/deposits', requireAdmin, requireAdminIP, (req, res) => {
    const deposits = newestFirst(loadJson('./database/deposits.json', []))
    res.render('admin/admin-deposits', {
      admin: req.session.admin,
      deposits,
      currentPath: '/admin/deposits'
    })
  })

  app.get('/admin/withdrawals', requireAdmin, requireAdminIP, (req, res) => {
    const withdrawals = newestFirst(loadJson('./database/withdrawals.json', []))
    res.render('admin/admin-withdrawals', {
      admin: req.session.admin,
      withdrawals,
      currentPath: '/admin/withdrawals'
    })
  })

  // Admin withdrawal approval deducts from the user's total deposit wallet

  app.post('/admin/withdraw/approve', requireAdmin, requireAdminIP, (req, res) => {

    const withdrawalId = Number(req.body.id || req.body.withdrawalId)

    if (!withdrawalId) {

      setToast(req, 'error', 'Withdrawal not found')

      return res.redirect('/admin/withdrawals')

    }

    res.redirect(307, `/admin/withdrawals/approve/${withdrawalId}`)

  })



  app.post('/admin/withdraw/reject', requireAdmin, requireAdminIP, (req, res) => {

    const withdrawalId = Number(req.body.id || req.body.withdrawalId)

    if (!withdrawalId) {

      setToast(req, 'error', 'Withdrawal not found')

      return res.redirect('/admin/withdrawals')

    }

    res.redirect(307, `/admin/withdrawals/reject/${withdrawalId}`)

  })
  app.post('/admin/withdrawals/approve/:id', requireAdmin, requireAdminIP, async (req, res) => {
    try {
      const withdrawalId = Number(req.params.id)
      const withdrawals = newestFirst(loadJson('./database/withdrawals.json', []))
      const users = loadUsers()

      const withdrawal = withdrawals.find(w => w.id === withdrawalId)
      if (!withdrawal) {
        setToast(req, 'error', 'Withdrawal not found')
        return res.redirect('/admin/withdrawals')
      }

      if (String(withdrawal.status).toLowerCase() !== 'pending') {
        setToast(req, 'error', 'Withdrawal is not pending')
        return res.redirect('/admin/withdrawals')
      }

      const user = users.find(u => u.id === withdrawal.userId)
      if (!user) {
        setToast(req, 'error', 'User not found')
        return res.redirect('/admin/withdrawals')
      }

      if (Number(user.deposit || 0) < withdrawal.amount) {
        setToast(req, 'error', 'User has insufficient total deposit')
        return res.redirect('/admin/withdrawals')
      }

      user.deposit = Number(user.deposit || 0) - Number(withdrawal.amount)
      withdrawal.status = 'approved'
      withdrawal.approvedAt = new Date().toISOString()

      saveUsers(users)
      saveJson('./database/withdrawals.json', withdrawals)

      logAdminAction(req, 'withdrawal_approved', { withdrawalId, userId: user.id, amount: withdrawal.amount })

      await notifyActivity(
        user,
        "Withdrawal Approved",
        `Your withdrawal of ${money(withdrawal.amount)} has been approved and is being processed. This amount has been deducted from your total deposit.`
      )

      setToast(req, 'success', 'Withdrawal approved')
      res.redirect('/admin/withdrawals')
    } catch (e) {
      console.error('Error approving withdrawal:', e)
      setToast(req, 'error', 'Error approving withdrawal')
      res.redirect('/admin/withdrawals')
    }
  })

  app.post('/admin/withdrawals/reject/:id', requireAdmin, requireAdminIP, async (req, res) => {
    try {
      const withdrawalId = Number(req.params.id)
      const withdrawals = newestFirst(loadJson('./database/withdrawals.json', []))
      const users = loadUsers()

      const withdrawal = withdrawals.find(w => w.id === withdrawalId)
      if (!withdrawal || String(withdrawal.status).toLowerCase() !== 'pending') {
        setToast(req, 'error', 'Withdrawal not found or not pending')
        return res.redirect('/admin/withdrawals')
      }

      withdrawal.status = 'rejected'
      withdrawal.rejectedAt = new Date().toISOString()
      saveJson('./database/withdrawals.json', withdrawals)

      const user = users.find(u => u.id === withdrawal.userId)
      logAdminAction(req, 'withdrawal_rejected', { withdrawalId, userId: withdrawal.userId, amount: withdrawal.amount })

      if (user) {
        await notifyActivity(
          user,
          "Withdrawal Rejected",
          `Your withdrawal request of ${money(withdrawal.amount)} was not approved. Please review your funding history or contact support for more details.`
        )
      }

      setToast(req, 'success', 'Withdrawal rejected')
      res.redirect('/admin/withdrawals')
    } catch (e) {
      console.error('Error rejecting withdrawal:', e)
      setToast(req, 'error', 'Error rejecting withdrawal')
      res.redirect('/admin/withdrawals')
    }
  })

  // ===========================
  // ADMIN DEPOSIT APPROVE / REJECT
  // ===========================
  app.post('/admin/deposit/approve', requireAdmin, requireAdminIP, async (req, res) => {
    try {
      const { depositId } = req.body
      const id = Number(depositId)
      const deposits = newestFirst(loadJson('./database/deposits.json', []))
      const users = loadUsers()

      const deposit = deposits.find(d => d.id === id)
      if (!deposit) {
        return res.json({ success: false, message: 'Deposit not found' })
      }
      if (deposit.status !== 'pending') {
        return res.json({ success: false, message: 'Deposit is not pending' })
      }

      const user = users.find(u => u.id === deposit.userId)
      if (!user) {
        return res.json({ success: false, message: 'User not found' })
      }

      // Credit the user's spendable total deposit wallet
      deposit.status = 'approved'
      deposit.approvedAt = new Date().toISOString()
      user.deposit = Number(user.deposit || 0) + Number(deposit.amount)

      saveUsers(users)
      saveJson('./database/deposits.json', deposits)

      logAdminAction(req, 'deposit_approved', { depositId: id, userId: user.id, amount: deposit.amount })

      await notifyActivity(
        user,
        "Deposit Approved",
        `Your deposit of ${money(deposit.amount)} has been approved and credited to your total deposit. You can now use it for stocks, copy trading, packages, or withdrawals.`
      )

      return res.json({ success: true, message: `Deposit of $${deposit.amount} approved and credited to ${user.username}` })
    } catch (e) {
      console.error('Error approving deposit:', e)
      return res.json({ success: false, message: 'Server error approving deposit' })
    }
  })

  app.post('/admin/deposit/reject', requireAdmin, requireAdminIP, async (req, res) => {
    try {
      const { depositId } = req.body
      const id = Number(depositId)
      const deposits = newestFirst(loadJson('./database/deposits.json', []))
      const users = loadUsers()

      const deposit = deposits.find(d => d.id === id)
      if (!deposit) {
        return res.json({ success: false, message: 'Deposit not found' })
      }
      if (deposit.status !== 'pending') {
        return res.json({ success: false, message: 'Deposit is not pending' })
      }

      deposit.status = 'rejected'
      deposit.rejectedAt = new Date().toISOString()
      saveJson('./database/deposits.json', deposits)

      logAdminAction(req, 'deposit_rejected', { depositId: id, userId: deposit.userId, amount: deposit.amount })

      const user = users.find(u => u.id === deposit.userId)
      if (user) {
        await notifyActivity(
          user,
          "Deposit Rejected",
          `Your deposit request for ${money(deposit.amount)} was not approved. Please review the proof uploaded or contact support for more details.`
        )
      }

      return res.json({ success: true, message: `Deposit of $${deposit.amount} rejected` })
    } catch (e) {
      console.error('Error rejecting deposit:', e)
      return res.json({ success: false, message: 'Server error rejecting deposit' })
    }
  })

  app.get('/admin/deposit/add', requireAdmin, requireAdminIP, (req, res) => {
    const users = loadUsers()
    res.render('admin/admin-add-deposit', {
      admin: req.session.admin,
      users,
      currentPath: '/admin/deposit/add'
    })
  })

  app.get('/admin/payment-settings', requireAdmin, requireAdminIP, (req, res) => {
    res.redirect('/admin/deposit-methods')
  })

  app.get('/admin/kyc', requireAdmin, requireAdminIP, (req, res) => {
    const kycRequests = newestFirst(loadJson('./database/kyc.json', []))
    res.render('admin/admin-kyc', {
      admin: req.session.admin,
      kycRequests,
      currentPath: '/admin/kyc'
    })
  })

  app.post('/admin/kyc/approve', requireAdmin, requireAdminIP, async (req, res) => {
    try {
      const { kycId } = req.body
      const id = Number(kycId)
      const kycRequests = newestFirst(loadJson('./database/kyc.json', []))
      const users = loadUsers()

      const kyc = kycRequests.find(k => k.id === id)
      if (!kyc) return res.json({ success: false, message: 'KYC request not found' })
      if (kyc.status !== 'pending') return res.json({ success: false, message: 'KYC is not pending' })

      const user = users.find(u => u.id === kyc.userId)
      if (!user) return res.json({ success: false, message: 'User not found' })

      kyc.status = 'approved'
      kyc.approvedAt = new Date().toISOString()
      user.kycStatus = 'Verified'

      saveJson('./database/kyc.json', kycRequests)
      saveUsers(users)

      logAdminAction(req, 'kyc_approved', { kycId: id, userId: user.id })

      await notifyActivity(
        user,
        "KYC Approved",
        "Your identity verification has been approved. Your account is now fully verified and eligible for supported account features."
      )

      return res.json({ success: true, message: `KYC approved for ${user.username}` })
    } catch (e) {
      console.error('Error approving KYC:', e)
      return res.json({ success: false, message: 'Server error approving KYC' })
    }
  })

  app.post('/admin/kyc/reject', requireAdmin, requireAdminIP, async (req, res) => {
    try {
      const { kycId } = req.body
      const id = Number(kycId)
      const kycRequests = newestFirst(loadJson('./database/kyc.json', []))
      const users = loadUsers()

      const kyc = kycRequests.find(k => k.id === id)
      if (!kyc) return res.json({ success: false, message: 'KYC request not found' })
      if (kyc.status !== 'pending') return res.json({ success: false, message: 'KYC is not pending' })

      const user = users.find(u => u.id === kyc.userId)

      kyc.status = 'rejected'
      kyc.rejectedAt = new Date().toISOString()
      if (user) user.kycStatus = 'Rejected'

      saveJson('./database/kyc.json', kycRequests)
      if (user) saveUsers(users)

      logAdminAction(req, 'kyc_rejected', { kycId: id, userId: kyc.userId })

      if (user) {
        await notifyActivity(
          user,
          "KYC Rejected",
          "Your identity verification was not approved. Please resubmit with clear, valid details or contact support for guidance."
        )
      }

      return res.json({ success: true, message: `KYC rejected for ${kyc.userName}` })
    } catch (e) {
      console.error('Error rejecting KYC:', e)
      return res.json({ success: false, message: 'Server error rejecting KYC' })
    }
  })

  app.get('/admin/deposit-methods', requireAdmin, requireAdminIP, (req, res) => {
    let methods = loadJson('./database/depositMethods.json', [])
    if (!methods.length) {
      methods = [
        { id: Date.now(), name: 'Bank Transfer', wallet: '', enabled: false },
        { id: Date.now() + 1, name: 'Cryptocurrency', wallet: '', enabled: false },
        { id: Date.now() + 2, name: 'Cash App', wallet: '', enabled: false },
        { id: Date.now() + 3, name: 'PayPal', wallet: '', enabled: false }
      ]
      saveJson('./database/depositMethods.json', methods)
    }
    res.render('admin/admin-deposit-methods', {
      admin: req.session.admin,
      methods,
      currentPath: '/admin/deposit-methods'
    })
  })

  app.post('/admin/deposit-methods/add', requireAdmin, requireAdminIP, (req, res) => {
    const { name } = req.body
    if (!name) return res.redirect('/admin/deposit-methods')

    const methods = loadJson('./database/depositMethods.json', [])
    methods.push({ id: Date.now(), name, wallet: '', enabled: false })

    saveJson('./database/depositMethods.json', methods)
    setToast(req, 'success', 'Payment method added')
    res.redirect('/admin/deposit-methods')
  })

  // FIX #1: Removed duplicate route - only one handler for deposit-methods/update/:id
  app.post('/admin/deposit-methods/update/:id', requireAdmin, requireAdminIP, upload.single('qrImage'), (req, res) => {
    const { name, wallet, enabled } = req.body
    const id = Number(req.params.id)

    const methods = loadJson('./database/depositMethods.json', [])
    const method = methods.find(m => m.id === id)
    if (!method) return res.redirect('/admin/deposit-methods')

    method.name = String(name || method.name).trim()
    method.wallet = wallet
    method.enabled = enabled === 'on'
    if (req.file) {
      method.qrImage = `/uploads/${req.file.filename}`
    }

    saveJson('./database/depositMethods.json', methods)
    setToast(req, 'success', 'Payment method updated')
    res.redirect('/admin/deposit-methods')
  })

  app.post('/admin/deposit-methods/delete/:id', requireAdmin, requireAdminIP, (req, res) => {
    const id = Number(req.params.id)
    const methods = loadJson('./database/depositMethods.json', [])
    saveJson('./database/depositMethods.json', methods.filter(method => method.id !== id))
    setToast(req, 'success', 'Payment method deleted')
    res.redirect('/admin/deposit-methods')
  })

  // ===========================
  // ADMIN PASSWORD CHANGE ROUTE (FIX #1: removed duplicate)
  // ===========================
  app.post('/admin/change-password', requireAdmin, requireAdminIP, async (req, res) => {
    try {
      const { current_password, new_password, confirm_password } = req.body
      const admins = loadAdmins()
      const admin = admins.find(a => a.id === req.session.admin.id)

      if (!admin) return res.json({ success: false, message: 'Admin not found' })

      let isValid = false
      if (admin.password && admin.password.startsWith('$2')) {
        isValid = await bcrypt.compare(current_password, admin.password)
      } else {
        isValid = (admin.password === current_password)
      }

      if (!isValid) return res.json({ success: false, message: 'Current password is incorrect' })
      if (new_password.length < 6) return res.json({ success: false, message: 'New password must be at least 6 characters' })
      if (new_password !== confirm_password) return res.json({ success: false, message: 'New passwords do not match' })

      const hasUpperCase = /[A-Z]/.test(new_password)
      const hasNumber = /[0-9]/.test(new_password)
      const hasSpecial = /[^A-Za-z0-9]/.test(new_password)

      if (!hasUpperCase || !hasNumber || !hasSpecial) {
        return res.json({ success: false, message: 'Password must contain uppercase, number, and special character' })
      }

      admin.password = await bcrypt.hash(new_password, 12)
      saveAdmins(admins)

      logAdminAction(req, 'password_change', { adminId: admin.id })
      res.json({ success: true, message: 'Password changed successfully' })
    } catch (error) {
      console.error('Admin password change error:', error)
      res.json({ success: false, message: 'Error changing password' })
    }
  })

  // ===========================
  // ADMIN USERNAME UPDATE ROUTE
  // ===========================
  app.post('/admin/update-username', requireAdmin, requireAdminIP, async (req, res) => {
    try {
      const { new_username, password } = req.body
      const admins = loadAdmins()
      const admin = admins.find(a => a.id === req.session.admin.id)

      if (!admin) return res.json({ success: false, message: 'Admin not found' })

      let isValid = false
      if (admin.password && admin.password.startsWith('$2')) {
        isValid = await bcrypt.compare(password, admin.password)
      } else {
        isValid = (admin.password === password)
      }

      if (!isValid) return res.json({ success: false, message: 'Password is incorrect' })
      if (!new_username || new_username.length < 3) return res.json({ success: false, message: 'Username must be at least 3 characters' })
      if (!/^[a-zA-Z0-9_]+$/.test(new_username)) return res.json({ success: false, message: 'Username can only contain letters, numbers, and underscore' })

      const usernameExists = admins.find(a => a.username === new_username && a.id !== admin.id)
      if (usernameExists) return res.json({ success: false, message: 'Username already taken' })

      const oldUsername = admin.username
      admin.username = new_username
      saveAdmins(admins)

      req.session.admin.username = new_username
      logAdminAction(req, 'username_change', { adminId: admin.id, oldUsername, newUsername: new_username })

      res.json({ success: true, message: 'Username updated successfully' })
    } catch (error) {
      console.error('Admin username update error:', error)
      res.json({ success: false, message: 'Error updating username' })
    }
  })

  // ===========================
  // CHECK USERNAME AVAILABILITY
  // ===========================
  app.get('/admin/check-username', requireAdmin, requireAdminIP, (req, res) => {
    const { username } = req.query
    const admins = loadAdmins()
    const exists = admins.some(a => a.username === username && a.id !== req.session.admin.id)
    res.json({ available: !exists })
  })

  // ===========================

}
