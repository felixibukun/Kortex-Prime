module.exports = function registerAuthRoutes(app, ctx) {
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

  app.get('/forgot-password', (req, res) => {
    setToast(req, 'info', 'Please contact support to reset your password securely.')
    res.redirect('/login')
  })

  app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard')
    res.render('auth/login')
  })

  app.post('/login', authLimit, async (req, res) => {
    try {
      const { username, password } = req.body
      const users = loadUsers()
      const user = users.find(u => u.username === username)

      if (!user) {
        setToast(req, 'error', 'Invalid username or password')
        return res.redirect('/login')
      }

      const ok = await bcrypt.compare(password, user.password)
      if (!ok) {
        setToast(req, 'error', 'Invalid username or password')
        return res.redirect('/login')
      }

      user.lastLoginAt = new Date().toISOString()
      user.lastLoginIp = getClientIp(req)
      user.loginCount = Number(user.loginCount || 0) + 1
      saveUsers(users)

      req.session.user = {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role
      }

      delete req.session.adminPreview
      delete req.session.admin

      if (process.env.LOGIN_EMAIL_NOTIFICATIONS === 'true') {
        notifyActivity(
          user,
          'New Sign-In',
          `A successful sign-in was recorded for ${user.username} from ${user.lastLoginIp || 'your device'}.`
        ).catch(e => console.error('Email notify error (login):', e))
      }

      req.session.save(() => {
        res.redirect('/dashboard')
      })
    } catch (e) {
      console.error('Login error:', e)
      setToast(req, 'error', 'Login error')
      res.redirect('/login')
    }
  })

  app.get('/signup', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard')
    res.render('auth/signup')
  })

  app.post('/signup', authLimit, async (req, res) => {
    try {
      const { username, name, email, phone, phoneCode, country, timezone, password } = req.body

      if (!username || !name || !email || !phone || !country || !timezone || !password) {
        setToast(req, 'error', 'All fields are required')
        return res.redirect('/signup')
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email)) {
        setToast(req, 'error', 'Invalid email format')
        return res.redirect('/signup')
      }

      if (password.length < 6) {
        setToast(req, 'error', 'Password must be at least 6 characters')
        return res.redirect('/signup')
      }

      const cleanPhoneCode = String(phoneCode || '').trim()
      const cleanPhone = String(phone || '').trim()
      const normalizedPhone = cleanPhone.startsWith('+')
        ? cleanPhone
        : `${cleanPhoneCode || '+1'} ${cleanPhone}`.trim()

      const users = loadUsers()

      if (users.find(u => u.username === username)) {
        setToast(req, 'error', 'Username already exists')
        return res.redirect('/signup')
      }

      if (users.find(u => u.email === email)) {
        setToast(req, 'error', 'Email already registered')
        return res.redirect('/signup')
      }

      const hashedPassword = await bcrypt.hash(password, 12)
      const user = {
        id: Date.now(),
        username,
        name,
        email,
        phone: normalizedPhone,

        phoneCode: cleanPhoneCode || null,
        country,
        timezone,
        password: hashedPassword,
        balance: 0,
        profit: 0,
        bonus: 0,
        deposit: 0,
        referralBonus: 0,
        verified: false,
        kycStatus: 'Not Verified',
        role: 'user',
        createdAt: new Date().toISOString()
      }

      users.push(user)
      saveUsers(users)

      req.session.user = {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role
      }

      delete req.session.adminPreview
      delete req.session.admin

      

      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err)
          setToast(req, 'error', 'Error creating account')
          return res.redirect('/signup')
        }

        notifyActivity(
          user,
          "Welcome to Kortex Prime",
          `Welcome ${user.name}! Your trading account has been created.`
        ).catch(e => console.error('Email error:', e))

        setToast(req, 'success', 'Account created successfully')
        res.redirect('/dashboard')
      })
    } catch (e) {
      console.error('Signup error:', e)
      setToast(req, 'error', 'Error creating account. Please try again.')
      res.redirect('/signup')
    }
  })

  app.get('/verify', requireLogin, (req, res) => {
    res.render('auth/verify')
  })

  app.post('/verify', requireLogin, (req, res) => {
    const code = String(req.body.code || '').trim()
    const users = loadUsers()
    const user = users.find(u => u.id === req.session.user.id)

    if (!user) {
      setToast(req, 'error', 'User not found')
      return res.redirect('/login')
    }

    const verifyRecords = loadVerify()
    const recordIndex = verifyRecords.findIndex(v =>
      String(v.userId || '') === String(user.id) &&
      String(v.code || '').trim() === code &&
      (!v.expiresAt || new Date(v.expiresAt) > new Date())
    )

    if (recordIndex === -1) {
      setToast(req, 'error', 'Invalid or expired verification code')
      return res.redirect('/verify')
    }

    user.verified = true
    saveUsers(users)
    verifyRecords.splice(recordIndex, 1)
    saveVerify(verifyRecords)

    setToast(req, 'success', 'Email verified successfully')
    res.redirect('/dashboard')
  })

  app.get('/resend-code', requireLogin, async (req, res) => {
    const users = loadUsers()
    const user = users.find(u => u.id === req.session.user.id)

    if (!user) {
      setToast(req, 'error', 'User not found')
      return res.redirect('/login')
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const verifyRecords = loadVerify().filter(v => String(v.userId || '') !== String(user.id))
    verifyRecords.push({
      userId: user.id,
      email: user.email,
      code,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    })
    saveVerify(verifyRecords)

    try {
      await notify(user.email, 'Kortex Prime Verification Code', `Your verification code is ${code}. It expires in 15 minutes.`)
      setToast(req, 'success', 'Verification code sent')
    } catch (e) {
      console.error('Email notify error (verification):', e)
      setToast(req, 'error', 'Could not send verification email')
    }

    res.redirect('/verify')
  })

  app.get('/logout', (req, res) => {

    delete req.session.adminPreview

    req.session.destroy((err) => {
      if (err) console.error('Logout error:', err)
      res.redirect('/login')
    })
  })

  // ===========================

}
