module.exports = function registerUserRoutes(app, ctx) {
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

  // DASHBOARD ROUTE
  // ===========================
  app.get('/dashboard', requireLogin, async (req, res) => {
    try {
      const users = loadUsers()
      const holdings = loadJson('./database/holdings.json', [])
      const trades = loadJson('./database/trades.json', [])
      const subscriptions = loadJson('./database/subscriptions.json', [])
      const stocks = loadJson('./database/stocks.json', [])

      const user = users.find(u => u.id === req.session.user.id)
      if (!user) {
        setToast(req, 'error', 'User not found')
        return res.redirect('/login')
      }

      const financialStats = calculateUserFinancialStats(user.id)

      const userHoldings = holdings.filter(h => h.userId === user.id).map(h => {
        const stock = stocks.find(s => s.id == h.stockId)
        const currentPrice = stock ? stock.price : h.avgPrice * 1.02
        const plPercent = ((currentPrice - h.avgPrice) / h.avgPrice * 100)
        return {
          ...h,
          currentPrice: Number(currentPrice.toFixed(2)),
          plPercent: Number(plPercent.toFixed(1)),
          stockName: h.stockName || stock?.name || 'Unknown',
          symbol: h.symbol || stock?.symbol || 'N/A'
        }
      })

      const userTrades = newestFirst(trades.filter(t => t.userId === user.id))
      const following = loadJson('./database/following.json', [])
      const activeCopyTrades = newestFirst(following.filter(f => f.userId === user.id && f.status !== 'closed'))
      const openTrades = activeCopyTrades.length

      const marketData = await getRealMarketData()
      const performanceData = generatePerformanceData(financialStats.totalBalance || 10000)

      const mappedUser = {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        phone: user.phone,
        country: user.country,
        kycStatus: user.kycStatus || 'Not Verified',
        totalDeposit: financialStats.totalDeposit,
        balance: financialStats.totalBalance,
        bonus: financialStats.bonus,
        totalProfit: financialStats.totalProfit,
        totalWithdrawal: financialStats.totalWithdrawal,
        netProfit: financialStats.netProfit,
        referralBonus: financialStats.referralBonus,
        deposit: financialStats.totalDeposit,
        profit: financialStats.totalProfit,
        winRate: financialStats.winRate,
        activeTrades: financialStats.activeTrades,
        portfolioValue: financialStats.portfolioValue
      }

      res.render('user/dashboard', {
        user: mappedUser,
        openTrades,
        activeCopyTrades,
        holdings: userHoldings,
        trades: userTrades,
        subscriptions: newestFirst(subscriptions.filter(s => s.userId === user.id)),
        marketData,
        performanceData,
        currentPath: '/dashboard',
        impersonating: !!req.session.adminPreview && String(req.session.adminPreview.userId) === String(user.id),
        cryptoPrices: {
          btc: marketData.btcPrice,
          eth: marketData.ethPrice,
          sol: marketData.solPrice,
          ada: marketData.adaPrice,
          doge: marketData.dogePrice
        },
        stockPrices: {
          sp500: marketData.sp500Price,
          nasdaq: marketData.nasdaqPrice,
          dowjones: marketData.dowjonesPrice,
          aapl: 175.25,
          tsla: 172.63,
          nvda: 903.56
        }
      })
    } catch (error) {
      console.error('Dashboard error:', error)
      setToast(req, 'error', 'Error loading dashboard')
      res.redirect('/login')
    }
  })

  // ===========================
  // TRADING ROUTES
  // ===========================
  app.get('/stocks', requireLogin, (req, res) => {
    try {
      const stocks = loadJson('./database/stocks.json', [])
      res.render('user/stocks', {
        user: loadUsers().find(u => u.id === req.session.user.id) || req.session.user,
        stocks,
        currentPath: '/stocks'
      })
    } catch (e) {
      // FIX #5: Log actual error instead of swallowing it
      console.error('Error loading stocks:', e)
      setToast(req, 'error', 'Error loading stocks')
      res.redirect('/dashboard')
    }
  })

  app.post('/stocks/buy', requireLogin, async (req, res) => {
    try {
      const { stockId, quantity } = req.body
      const qty = Number(quantity)
      if (!qty || qty <= 0) {
        setToast(req, 'error', 'Invalid quantity')
        return res.redirect('/stocks')
      }

      const stocks = loadJson('./database/stocks.json', [])
      const users = loadUsers()
      const holdings = loadJson('./database/holdings.json', [])
      const trades = loadJson('./database/trades.json', [])

      const user = users.find(u => u.id === req.session.user.id)
      const stock = stocks.find(s => s.id == stockId)

      if (!stock) {
        setToast(req, 'error', 'Stock not found')
        return res.redirect('/stocks')
      }

      const totalCost = stock.price * qty
      if (Number(user.deposit || 0) < totalCost) {
        setToast(req, 'error', 'Insufficient total deposit')
        return res.redirect('/stocks')
      }

      let holding = holdings.find(h => h.userId === user.id && h.stockId === stock.id)
      if (holding) {
        const oldTotal = holding.avgPrice * holding.quantity
        const newTotal = stock.price * qty
        const newQty = holding.quantity + qty
        holding.avgPrice = (oldTotal + newTotal) / newQty
        holding.quantity = newQty
      } else {
        holding = {
          id: Date.now(),
          userId: user.id,
          stockId: stock.id,
          stockName: stock.name,
          symbol: stock.symbol,
          quantity: qty,
          avgPrice: stock.price
        }
        holdings.push(holding)
      }

      trades.push({
        id: Date.now(),
        userId: user.id,
        stockId: stock.id,
        stockName: stock.name,
        symbol: stock.symbol,
        side: 'BUY',
        quantity: qty,
        price: stock.price,
        total: totalCost,
        profit: 0,
        timestamp: new Date().toISOString()
      })

      user.deposit = Number(user.deposit || 0) - totalCost
      saveUsers(users)
      saveJson('./database/holdings.json', holdings)
      saveJson('./database/trades.json', trades)

      // FIX #5: Properly await email and catch errors with logging
      await notifyActivity(
        user,
        "Trade Executed",
        `Your BUY order for ${qty} ${stock.symbol} shares executed at ${money(stock.price)} per share. Total deducted from your total deposit: ${money(totalCost)}.`
      )

      setToast(req, 'success', 'Stock bought successfully')
      res.redirect('/stocks')
    } catch (e) {
      console.error('Error buying stock:', e)
      setToast(req, 'error', 'Error buying stock')
      res.redirect('/stocks')
    }
  })

  app.post('/stocks/sell', requireLogin, async (req, res) => {
    try {
      const { stockId, quantity } = req.body
      const qty = Number(quantity)
      if (!qty || qty <= 0) {
        setToast(req, 'error', 'Invalid quantity')
        return res.redirect('/dashboard')
      }

      const users = loadUsers()
      const holdings = loadJson('./database/holdings.json', [])
      const trades = loadJson('./database/trades.json', [])
      const stocks = loadJson('./database/stocks.json', [])

      const user = users.find(u => u.id === req.session.user.id)
      const stock = stocks.find(s => s.id == stockId)

      if (!user || !stock) {
        setToast(req, 'error', 'Invalid stock')
        return res.redirect('/dashboard')
      }

      const holding = holdings.find(h => h.userId === user.id && h.stockId == stock.id)
      if (!holding) {
        setToast(req, 'error', 'You do not own this stock')
        return res.redirect('/dashboard')
      }

      if (holding.quantity < qty) {
        setToast(req, 'error', 'Not enough units')
        return res.redirect('/dashboard')
      }

      const totalSell = stock.price * qty
      const avgPrice = Number(holding.avgPrice)
      const profit = (stock.price - avgPrice) * qty

      holding.quantity -= qty
      if (holding.quantity === 0) {
        const i = holdings.indexOf(holding)
        holdings.splice(i, 1)
      }

      user.deposit = Number(user.deposit || 0) + totalSell
      user.profit = Number(user.profit || 0) + profit

      trades.push({
        id: Date.now(),
        userId: user.id,
        stockId: stock.id,
        stockName: stock.name,
        symbol: stock.symbol,
        side: 'SELL',
        quantity: qty,
        price: stock.price,
        total: totalSell,
        profit: profit,
        timestamp: new Date().toISOString()
      })

      saveUsers(users)
      saveJson('./database/holdings.json', holdings)
      saveJson('./database/trades.json', trades)

      // FIX #5: Properly await email and catch errors with logging
      await notifyActivity(
        user,
        "Trade Executed",
        `Your SELL order for ${qty} ${stock.symbol} shares executed at ${money(stock.price)} per share. Estimated proceeds credited to your total deposit: ${money(totalSell)}. Trade P/L: ${money(profit)}.`
      )

      setToast(req, 'success', 'Stock sold successfully')
      res.redirect('/dashboard')
    } catch (e) {
      console.error('Error selling stock:', e)
      setToast(req, 'error', 'Error selling stock')
      res.redirect('/dashboard')
    }
  })

  // ===========================
  // COPY TRADER ROUTES - FIXED: Deducts from balance
  // ===========================
  app.get('/copy-trader', requireLogin, (req, res) => {
    try {
      const traders = loadJson('./database/copytraders.json', [])
      const following = loadJson('./database/following.json', [])
      const users = loadUsers()
      const user = users.find(u => u.id === req.session.user.id)
      
      // Get user's active copy trades
      const userFollowing = following.filter(f => f.userId === req.session.user.id && f.status !== 'closed')
      
      res.render('user/copytrader', {
        user: user || req.session.user,
        traders: traders,
        following: userFollowing,  // Pass following to the view
        currentPath: '/copy-trader'
      })
    } catch (e) {
      console.error('Error loading copy traders:', e)
      setToast(req, 'error', 'Error loading copy traders')
      res.redirect('/dashboard')
    }
  })

  // Copy trading deducts from the spendable total deposit wallet
  app.post('/copy-trader/follow', requireLogin, async (req, res) => {
    try {
      const { traderId, amount } = req.body
      const followAmount = Number(amount) || 500 // Default $500 if not specified
      
      const users = loadUsers()
      const user = users.find(u => u.id === req.session.user.id)
      const traders = loadJson('./database/copytraders.json', [])
      const trader = traders.find(t => t.id == traderId)

      if (!trader) {
        setToast(req, 'error', 'Trader not found')
        return res.redirect('/copy-trader')
      }

      // Check minimum amount
      const minAmount = trader.minAmount || 100
      if (followAmount < minAmount) {
        setToast(req, 'error', `Minimum copy trade amount is $${minAmount}`)
        return res.redirect('/copy-trader')
      }

      if (Number(user.deposit || 0) < followAmount) {
        setToast(req, 'error', `Insufficient total deposit. You have $${Number(user.deposit || 0).toLocaleString()}`)
        return res.redirect('/copy-trader')
      }

      const following = loadJson('./database/following.json', [])

      user.deposit = Number(user.deposit || 0) - followAmount

      following.push({
        id: Date.now(),
        userId: user.id,
        traderId: trader.id,
        traderName: trader.name,
        amount: followAmount,
        startedAt: new Date().toISOString(),
        status: 'active'
      })

      saveUsers(users)  // Save the updated balance
      saveJson('./database/following.json', following)

      await notifyActivity(
        user,
        "Copy Trader Activated",
        `You have started copying ${trader.name} with ${money(followAmount)}. This amount has been deducted from your total deposit and the copy trade is now active.`
      )

      setToast(req, 'success', `Copy Trader activated - $${followAmount} deducted from total deposit`)
      res.redirect('/copy-trader')
    } catch (e) {
      console.error('Error following trader:', e)
      setToast(req, 'error', 'Error following trader')
      res.redirect('/copy-trader')
    }
  })

  // Stop copy trading and refund
  app.post('/copy-trader/stop', requireLogin, async (req, res) => {
    try {
      const { traderId, followId } = req.body
      const following = loadJson('./database/following.json', [])
      const users = loadUsers()
      const user = users.find(u => u.id === req.session.user.id)
      
      const followIndex = followId
        ? following.findIndex(f => f.userId === user.id && String(f.id) === String(followId) && f.status === 'active')
        : following.findIndex(f => f.userId === user.id && f.traderId == traderId && f.status === 'active')
      
      if (followIndex === -1) {
        setToast(req, 'error', 'Not following this trader')
        return res.redirect('/copy-trader')
      }
      
      const follow = following[followIndex]
      
      user.deposit = Number(user.deposit || 0) + Number(follow.amount)
      follow.status = 'closed'
      follow.endedAt = new Date().toISOString()
      
      saveUsers(users)
      saveJson('./database/following.json', following)

      await notifyActivity(
        user,
        "Copy Trader Stopped",
        `Copy trading with ${follow.traderName || 'your selected trader'} has been stopped. ${money(follow.amount)} has been returned to your total deposit.`
      )
      
      setToast(req, 'success', `Stopped copy trading - $${follow.amount} refunded to total deposit`)
      res.redirect('/copy-trader')
    } catch (e) {
      console.error('Error stopping copy trade:', e)
      setToast(req, 'error', 'Error stopping copy trade')
      res.redirect('/copy-trader')
    }
  })

  // ===========================
  // FINANCIAL ROUTES
  // ===========================
  app.get('/deposit-withdrawal', requireLogin, (req, res) => {
    try {
      const deposits = loadJson('./database/deposits.json', [])
      const depositMethods = loadJson('./database/depositMethods.json', []).filter(m => m.enabled !== false)
      const userDeposits = newestFirst(deposits.filter(d => d.userId === req.session.user.id))

      res.render('user/deposit-withdrawal', {
        user: req.session.user,
        deposits: userDeposits,
        depositMethods,
        currentPath: '/deposit-withdrawal'
      })
    } catch (e) {
      console.error('Error loading deposit page:', e)
      setToast(req, 'error', 'Error loading deposit page')
      res.redirect('/dashboard')
    }
  })

  app.post('/deposit', requireLogin, upload.single('proof'), async (req, res) => {
    try {
      const { amount, method } = req.body
      const users = loadUsers()
      const user = users.find(u => u.id === req.session.user.id)
      const depositMethods = loadJson('./database/depositMethods.json', [])
      const methodCfg = depositMethods.find(m => m.name === method && m.enabled !== false)

      if (!methodCfg) {
        setToast(req, 'error', 'Method not available')
        return res.redirect('/deposit-withdrawal')
      }

      if (methodCfg.available === false) {
        setToast(req, 'error', 'Bank Transfer is not available at the moment')
        return res.redirect('/deposit-withdrawal')
      }

      const deposits = loadJson('./database/deposits.json', [])
      const proofUrl = req.file ? '/uploads/' + req.file.filename : ''

      deposits.push({
        id: Date.now(),
        userId: user.id,
        username: user.username,
        amount: Number(amount),
        method,
        status: 'pending',
        proofUrl,
        createdAt: new Date().toISOString()
      })

      saveJson('./database/deposits.json', deposits)

      await notifyActivity(
        user,
        "Deposit Submitted",
        `Your ${method} deposit request for ${money(amount)} has been received and is pending review. Your total deposit will update after approval.`
      )

      setToast(req, 'success', 'Deposit submitted')
      res.redirect('/deposit-withdrawal')
    } catch (e) {
      console.error('Error processing deposit:', e)
      setToast(req, 'error', 'Error processing deposit')
      res.redirect('/deposit-withdrawal')
    }
  })

  app.get('/withdraw', requireLogin, (req, res) => {
    try {
      const users = loadUsers()
      const user = users.find(u => u.id === req.session.user.id)
      const withdrawals = newestFirst(loadJson('./database/withdrawals.json', []).filter(

        w => w.userId === req.session.user.id

      ))

      res.render('user/withdraw', {
        user,
        history: withdrawals,
        currentPath: '/withdraw'
      })
    } catch (e) {
      console.error('Error loading withdraw page:', e)
      setToast(req, 'error', 'Error loading withdraw page')
      res.redirect('/dashboard')
    }
  })

  // Withdrawal requests debit the user's balance immediately.
  app.post('/withdraw', requireLogin, async (req, res) => {
    try {
      const { amount, wallet, network } = req.body
      const payoutMethod = String(network || '').trim()
      const payoutDetails = String(wallet || '').trim()
      const users = loadUsers()
      const withdrawals = loadJson('./database/withdrawals.json', [])
      const user = users.find(u => u.id === req.session.user.id)
      const amt = Number(amount)

      if (!user || !Number.isFinite(amt) || amt < 10 || amt > Number(user.balance || 0)) {
        setToast(req, 'error', 'Invalid amount or insufficient balance')
        return res.redirect('/withdraw')
      }

      if (!payoutMethod || !payoutDetails) {
        setToast(req, 'error', 'Please enter your payout method and details')
        return res.redirect('/withdraw')
      }

      // Check for a pending withdrawal already - prevent double submission
      const hasPending = withdrawals.find(w => w.userId === user.id && w.status === 'pending')
      if (hasPending) {
        setToast(req, 'error', 'You already have a pending withdrawal request')
        return res.redirect('/withdraw')
      }

      user.balance = Number(user.balance || 0) - amt
      withdrawals.push({
        id: Date.now(),
        userId: user.id,
        username: user.username,
        amount: amt,
        wallet: payoutDetails,
        network: payoutMethod,
        method: payoutMethod,
        status: 'pending',
        debitedFrom: 'balance',
        debitedAt: new Date().toISOString(),
        date: new Date().toISOString()
      })

      saveUsers(users)
      saveJson('./database/withdrawals.json', withdrawals)
      // Amount has already been reserved from balance.

      await notifyActivity(
        user,
        "Withdrawal Submitted",
        `Your withdrawal request for ${money(amt)} on ${payoutMethod} has been received and is pending review. The amount has been debited from your balance.`
      )

      setToast(req, 'success', 'Withdrawal submitted')
      res.redirect('/withdraw')
    } catch (e) {
      console.error('Error processing withdrawal:', e)
      setToast(req, 'error', 'Error processing withdrawal')
      res.redirect('/withdraw')
    }
  })

  // ===========================
  // ACCOUNT ROUTES
  // ===========================
  app.get('/account', requireLogin, (req, res) => {
    const users = loadUsers()
    const user = users.find(u => u.id === req.session.user.id)
    res.render('user/account', {
      user,
      currentPath: '/account'
    })
  })

  app.post('/account/update', requireLogin, async (req, res) => {
    const { name, username, email, phone, country, timezone, password } = req.body
    const users = loadUsers()
    const user = users.find(u => u.id === req.session.user.id)

    const usernameExists = users.find(u => u.username === username && u.id !== user.id)
    if (usernameExists) {
      setToast(req, 'error', 'Username already taken')
      return res.redirect('/account')
    }

    const cleanEmail = String(email || '').trim().toLowerCase()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!cleanEmail || !emailRegex.test(cleanEmail)) {

      setToast(req, 'error', 'Enter a valid email address')

      return res.redirect('/account')

    }



    const emailExists = users.find(u => String(u.email || '').toLowerCase() === cleanEmail && u.id !== user.id)

    if (emailExists) {

      setToast(req, 'error', 'Email already taken')

      return res.redirect('/account')

    }



    user.name = name
    user.username = username
    user.email = cleanEmail

    user.phone = phone
    user.country = country
    user.timezone = timezone

    if (password && String(password).trim()) {
      if (String(password).length < 6) {
        setToast(req, 'error', 'Password must be at least 6 characters')
        return res.redirect('/account')
      }
      user.password = await bcrypt.hash(String(password), 12)
    }

    saveUsers(users)

    req.session.user.username = username
    req.session.user.name = name

    req.session.user.email = cleanEmail
    req.session.user.phone = phone
    req.session.user.country = country
    req.session.user.timezone = timezone

    await notifyActivity(
      user,
      "Profile Updated",
      "Your profile information was updated successfully. Keep your contact information current so account notices and funding updates reach you."
    )

    setToast(req, 'success', 'Profile updated successfully')
    req.session.save(() => res.redirect('/account'))
  })

  // ===========================
  // KYC ROUTES
  // ===========================
  app.get('/kyc-verification', requireLogin, (req, res) => {
    try {
      const kycRequests = newestFirst(loadJson('./database/kyc.json', []).filter(

        k => k.userId === req.session.user.id

      ))
      res.render('user/kyc-verification', {
        user: req.session.user,
        kycRequests,
        currentPath: '/kyc-verification'
      })
    } catch (e) {
      console.error('Error loading KYC page:', e)
      setToast(req, 'error', 'Error loading KYC page')
      res.redirect('/dashboard')
    }
  })

  app.post('/kyc-verification', requireLogin, async (req, res) => {
    try {
      const { documentType, documentNumber, note } = req.body
      const kycRequests = loadJson('./database/kyc.json', [])
      const users = loadUsers()
      const user = users.find(u => u.id === req.session.user.id)

      const entry = {
        id: Date.now(),
        userId: user.id,
        userName: user.username,
        documentType,
        documentNumber,
        note,
        status: 'pending',
        createdAt: new Date().toISOString()
      }

      kycRequests.push(entry)
      saveJson('./database/kyc.json', kycRequests)

      await notifyActivity(
        user,
        "KYC Submitted",
        `Your ${documentType || 'identity'} verification submission has been received and is under review. You will receive another email when the status changes.`
      )

      setToast(req, 'success', 'KYC submitted')
      res.redirect('/kyc-verification')
    } catch (e) {
      console.error('Error submitting KYC:', e)
      setToast(req, 'error', 'Error submitting KYC')
      res.redirect('/kyc-verification')
    }
  })

  // ===========================
  // PACKAGES ROUTES - FIXED: Deducts from balance
  // ===========================
  app.get('/packages', requireLogin, (req, res) => {
    const packages = [
      { name: "Starter", price: 500, profit: "5% weekly" },
      { name: "Standard", price: 1000, profit: "8% weekly" },
      { name: "Premium", price: 2000, profit: "12% weekly" },
      { name: "Advanced", price: 5000, profit: "15% weekly" },
      { name: "Gold", price: 10000, profit: "18% weekly" },
      { name: "Elite", price: 50000, profit: "20% weekly" }
    ]

    const users = loadUsers()
    const user = users.find(u => u.id === req.session.user.id) || req.session.user

    res.render('user/packages', {
      user,
      packages,
      currentPath: '/packages'
    })
  })

  // Package subscriptions deduct from the spendable total deposit wallet
  app.post('/packages/subscribe', requireLogin, async (req, res) => {
    const { price } = req.body
    const packages = [
      { name: "Starter", price: 500, profit: "5% weekly" },
      { name: "Standard", price: 1000, profit: "8% weekly" },
      { name: "Premium", price: 2000, profit: "12% weekly" },
      { name: "Advanced", price: 5000, profit: "15% weekly" },
      { name: "Gold", price: 10000, profit: "18% weekly" },
      { name: "Elite", price: 50000, profit: "20% weekly" }
    ]

    const selected = packages.find(p => p.price == price)
    if (!selected) {
      setToast(req, 'error', 'Package not found')
      return res.redirect('/packages')
    }

    const users = loadUsers()
    const user = users.find(u => u.id === req.session.user.id)

    if (Number(user.deposit || 0) < selected.price) {
      setToast(req, 'error', `Insufficient total deposit. Need $${selected.price}`)
      return res.redirect('/packages')
    }

    user.deposit = Number(user.deposit || 0) - selected.price
    
    const subscriptions = loadJson('./database/subscriptions.json', [])

    subscriptions.push({
      id: Date.now(),
      userId: user.id,
      package: selected.name,
      price: selected.price,
      profit: selected.profit,
      date: new Date().toISOString(),
      status: 'active'
    })

    saveUsers(users)  // Save the updated balance
    saveJson('./database/subscriptions.json', subscriptions)

    await notifyActivity(
      user,
      "Package Activated",
      `Your ${selected.name} package is now active with a listed return profile of ${selected.profit}. ${money(selected.price)} has been deducted from your total deposit.`
    )

    setToast(req, 'success', `${selected.name} package subscribed - $${selected.price} deducted from total deposit`)
    res.redirect('/packages')
  })

  // ===========================
  // HISTORY ROUTES
  // ===========================
  app.get('/package-history', requireLogin, (req, res) => {
    const subs = newestFirst(loadJson('./database/subscriptions.json', []).filter(

      s => s.userId === req.session.user.id

    ))
    res.render('user/package-history', {
      user: req.session.user,
      subs,
      currentPath: '/package-history'
    })
  })

  app.get('/trading-history', requireLogin, (req, res) => {
    const trades = newestFirst(loadJson('./database/trades.json', []).filter(t => t.userId === req.session.user.id))
    const following = newestFirst(loadJson('./database/following.json', []).filter(

      f => f.userId === req.session.user.id && f.status !== 'closed'

    ))
    const copyTraders = loadJson('./database/copytraders.json', [])
    const activeCopyTrades = following.map(follow => {
      const trader = copyTraders.find(t => String(t.id) === String(follow.traderId)) || {}
      return {
        ...follow,
        traderName: trader.name || follow.traderName || 'Copy Trader',
        winRate: Number(trader.winRate || 0),
        totalProfit: Number(trader.totalProfit || 0),
        followers: Number(trader.followers || 0)
      }
    })
    res.render('user/trading-history', {
      user: req.session.user,
      trades,
      activeCopyTrades,
      currentPath: '/trading-history'
    })
  })

  app.get('/transactions-history', requireLogin, (req, res) => {
    const deposits = loadJson('./database/deposits.json', []).filter(x => x.userId === req.session.user.id)
    const withdrawals = loadJson('./database/withdrawals.json', []).filter(x => x.userId === req.session.user.id)
    const transactions = [...deposits, ...withdrawals].sort((a, b) =>
      recordTime(b) - recordTime(a)
    )
    res.render('user/transactions-history', {
      user: req.session.user,
      transactions,
      currentPath: '/transactions-history'
    })
  })

  app.get('/funding-history', requireLogin, (req, res) => {
    res.redirect('/transactions-history')
  })

  app.get('/withdraw-history', requireLogin, (req, res) => {
    res.redirect('/transactions-history')
  })

  app.get('/pl-record', requireLogin, (req, res) => {
    const holdings = loadJson('./database/holdings.json', []).filter(h => h.userId === req.session.user.id)
    const stocks = loadJson('./database/stocks.json', [])

    const holdingsWithProfit = holdings.map(h => {
      const stock = stocks.find(s => s.id == h.stockId)
      const currentPrice = stock ? stock.price : h.avgPrice * 1.02
      const profit = (currentPrice - h.avgPrice) * h.quantity
      return {
        ...h,
        currentPrice: Number(currentPrice.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        stockName: h.stockName || stock?.name || 'Unknown',
        symbol: h.symbol || stock?.symbol || 'N/A'
      }
    })

    const totalProfit = holdingsWithProfit.reduce((sum, h) => sum + h.profit, 0)

    res.render('user/pl-record', {
      user: req.session.user,
      holdings: holdingsWithProfit,
      totalProfit: Number(totalProfit.toFixed(2)),
      currentPath: '/pl-record'
    })
  })

  // ===========================
  // SUPPORT ROUTES
  // ===========================
  app.get('/support', requireLogin, (req, res) => {
    try {
      const trades = newestFirst(loadJson('./database/trades.json', []).filter(t => t.userId === req.session.user.id))
      res.render('user/support', {
        user: req.session.user,
        trades,
        currentPath: '/support'
      })
    } catch (error) {
      console.error('Error loading support page:', error)
      setToast(req, 'error', 'Error loading support page')
      res.redirect('/dashboard')
    }
  })

  // ===========================

}
