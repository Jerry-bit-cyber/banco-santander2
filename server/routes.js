const express = require('express');
const jsonfile = require('jsonfile');
const router = express.Router();

const usersFile = './server/data/users.json';
const transactionsFile = './server/data/transactions.json';
const kycFile = './server/data/kyc.json';

// Initialize JSON files
jsonfile.readFile(usersFile, (err, data) => {
    if (err || !data) {
        jsonfile.writeFile(usersFile, { users: [{
            username: 'carlos.hernandez',
            password: 'secure123',
            fullName: 'Carlos Hernández',
            balance: 3100000
        }] });
    }
});
jsonfile.readFile(transactionsFile, (err, data) => {
    if (err || !data) {
        jsonfile.writeFile(transactionsFile, { transactions: [
            { username: 'carlos.hernandez', date: '2010-01-15', description: 'Salary Deposit', amount: 50000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-02-10', description: 'Investment Return', amount: 100000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-03-05', description: 'Property Sale', amount: 500000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-04-20', description: 'Business Revenue', amount: 200000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-05-12', description: 'Stock Dividend', amount: 25000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-06-08', description: 'Consulting Fee', amount: 75000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-07-14', description: 'Rental Income', amount: 30000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-08-19', description: 'Loan Repayment', amount: 150000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-09-25', description: 'Gift Received', amount: 10000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-10-30', description: 'Royalty Payment', amount: 80000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-11-11', description: 'Insurance Payout', amount: 300000, status: 'Completed' },
            { username: 'carlos.hernandez', date: '2010-12-05', description: 'Asset Sale', amount: 600000, status: 'Completed' }
        ] });
    }
});
jsonfile.readFile(kycFile, (err, data) => {
    if (err || !data) jsonfile.writeFile(kycFile, { kyc: [] });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Generate a Santander-México-style identification number: SMX-XXXXXXXX
function generateIdNumber() {
    var digits = '';
    for (var i = 0; i < 8; i++) {
        digits += Math.floor(Math.random() * 10);
    }
    return 'SMX-' + digits;
}

// Generate a 10-digit account number (numeric only)
function generateAccountNumber() {
    var n = '';
    for (var i = 0; i < 10; i++) {
        n += Math.floor(Math.random() * 10);
    }
    return n;
}

// Generate an 18-digit CLABE (Mexican bank standard layout).
// Layout: 3-digit bank code + 3-digit branch + 11-digit account + 1 check digit.
// For this prototype we use bank code "014" (Santander México) and a simple
// mod-10 weighted check digit, which is the actual algorithm Banxico uses.
function generateClabe() {
    var bankCode = '014';
    var branch = '000';
    var account = '';
    for (var i = 0; i < 11; i++) {
        account += Math.floor(Math.random() * 10);
    }
    var base = bankCode + branch + account; // 17 digits
    return base + clabeCheckDigit(base);
}

function clabeCheckDigit(base17) {
    // Weights cycle 3,7,1 applied to each digit position (Banxico spec).
    var weights = [3, 7, 1];
    var sum = 0;
    for (var i = 0; i < base17.length; i++) {
        var d = parseInt(base17.charAt(i), 10);
        var w = weights[i % 3];
        sum += (d * w) % 10;
    }
    return String((10 - (sum % 10)) % 10);
}

// Generate a transfer reference number: SMX-TRF-XXXXXXXX
function generateTransferReference() {
    var digits = '';
    for (var i = 0; i < 8; i++) {
        digits += Math.floor(Math.random() * 10);
    }
    return 'SMX-TRF-' + digits;
}

// Server timestamp for transactions and activation records
function nowIso() {
    return new Date().toISOString();
}

// Cap base64 image size server-side (defensive; client already caps at 5MB)
var MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function isAcceptableImageUpload(upload) {
    if (!upload || typeof upload !== 'object') return false;
    if (typeof upload.dataUrl !== 'string') return false;
    if (upload.dataUrl.length > MAX_IMAGE_BYTES) return false;
    if (!/^data:image\/(jpeg|png);base64,/.test(upload.dataUrl)) return false;
    return true;
}

// Resolve the effective KYC status for a user.
//
// Rules:
//   - If the record has an explicit kycStatus, use it.
//   - If the record has no kycStatus field, the user is treated as
//     "active". This is the case for the seeded primary account
//     (carlos.hernandez), which predates the KYC flow and must not be
//     gated. Newly created accounts always receive an explicit
//     kycStatus: 'pending' from POST /api/account, so they never fall
//     into this default.
function effectiveKycStatus(user) {
    if (!user) return 'pending';
    if (typeof user.kycStatus === 'string' && user.kycStatus.length > 0) {
        return user.kycStatus;
    }
    return 'active';
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Login
router.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = await jsonfile.readFile(usersFile);
    const user = users.users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.json({ success: false });
    }
    res.json({
        success: true,
        user: {
            username: user.username,
            fullName: user.fullName,
            email: user.email || user.username,
            idNumber: user.idNumber || null,
            photo: user.photo || null,
            kycStatus: effectiveKycStatus(user)
        }
    });
});

// ---------------------------------------------------------------------------
// Account opening (full KYC payload)
// ---------------------------------------------------------------------------

router.post('/api/account', async (req, res) => {
    const {
        fullName,
        birthdate,
        curp,
        rfc,
        idFront,
        idBack,
        photo,
        street,
        number,
        colonia,
        cp,
        city,
        state,
        phone,
        email,
        password
    } = req.body || {};

    // --- Required fields ---
    if (!fullName || !email || !password) {
        return res.json({ success: false, message: 'Missing required fields' });
    }
    if (password.length < 8) {
        return res.json({ success: false, message: 'Password too short' });
    }
    if (!isAcceptableImageUpload(idFront)) {
        return res.json({ success: false, message: 'Invalid ID front image' });
    }
    if (!isAcceptableImageUpload(idBack)) {
        return res.json({ success: false, message: 'Invalid ID back image' });
    }
    if (!isAcceptableImageUpload(photo)) {
        return res.json({ success: false, message: 'Invalid profile photo' });
    }

    const users = await jsonfile.readFile(usersFile);

    // --- Duplicate check ---
    if (users.users.find(u => u.email === email || u.username === email)) {
        return res.json({ success: false, message: 'Email already exists' });
    }

    // --- Generate identity fields ---
    const idNumber = generateIdNumber();
    const accountNumber = generateAccountNumber();
    const clabe = generateClabe();

    const newUser = {
        // Existing fields (kept for compatibility with older code paths)
        username: email,
        password,
        fullName,
        email,
        phone,
        balance: 0,

        // KYC data
        birthdate: birthdate || null,
        curp: (curp || '').toUpperCase(),
        rfc: (rfc || '').toUpperCase(),
        address: {
            street: street || '',
            number: number || '',
            colonia: colonia || '',
            cp: cp || '',
            city: city || '',
            state: state || ''
        },

        // Uploaded images stored as data URLs
        idFront,
        idBack,
        photo,

        // Bank identifiers
        idNumber,
        accountNumber,
        clabe,

        // Compliance / activation state.
        // New accounts start as 'pending' until the user completes
        // activation via POST /api/account/activate.
        kycStatus: 'pending',
        activatedAt: null,
        createdAt: nowIso()
    };

    users.users.push(newUser);
    await jsonfile.writeFile(usersFile, users);

    // Return the identity fields the client needs to display the result panel
    res.json({
        success: true,
        user: {
            fullName: newUser.fullName,
            idNumber: newUser.idNumber,
            accountNumber: newUser.accountNumber,
            clabe: newUser.clabe,
            email: newUser.email,
            rfc: newUser.rfc,
            kycStatus: newUser.kycStatus
        }
    });
});

// ---------------------------------------------------------------------------
// Account activation
// ---------------------------------------------------------------------------

router.post('/api/account/activate', async (req, res) => {
    const { email, agree } = req.body || {};

    if (!email) {
        return res.json({ success: false, message: 'Missing email' });
    }
    if (agree !== true) {
        return res.json({ success: false, message: 'Terms must be accepted' });
    }

    const users = await jsonfile.readFile(usersFile);
    const user = users.users.find(u => u.email === email || u.username === email);

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    user.kycStatus = 'active';
    user.activatedAt = nowIso();

    await jsonfile.writeFile(usersFile, users);

    res.json({
        success: true,
        user: {
            fullName: user.fullName,
            idNumber: user.idNumber,
            email: user.email,
            kycStatus: user.kycStatus,
            activatedAt: user.activatedAt
        }
    });
});

// ---------------------------------------------------------------------------
// KYC submission (kept for backward compatibility — no UI calls this)
// ---------------------------------------------------------------------------

router.post('/api/kyc', async (req, res) => {
    const kycData = req.body;
    const kyc = await jsonfile.readFile(kycFile);
    kyc.kyc.push(kycData);
    await jsonfile.writeFile(kycFile, kyc);
    res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

router.get('/api/dashboard', async (req, res) => {
    const { username } = req.query;
    const users = await jsonfile.readFile(usersFile);
    const transactions = await jsonfile.readFile(transactionsFile);
    const user = users.users.find(u => u.username === username);
    if (!user) return res.json({ success: false });

    const userTransactions = transactions.transactions.filter(t => t.username === username);

    // Pending balance = sum of transaction amounts with status 'Pending'
    const pendingBalance = userTransactions
        .filter(t => t.status === 'Pending')
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    res.json({
        success: true,
        balance: user.balance,
        pendingBalance,
        user: {
            fullName: user.fullName,
            email: user.email || user.username,
            idNumber: user.idNumber || null,
            accountNumber: user.accountNumber || null,
            clabe: user.clabe || null,
            photo: user.photo ? user.photo.dataUrl : null,
            kycStatus: effectiveKycStatus(user)
        },
        transactions: userTransactions
    });
});

// ---------------------------------------------------------------------------
// Transfer — Mexican domestic (SPEI-style) payload
// ---------------------------------------------------------------------------
//
// Client sends:
//   { username, accountNumber, email, amount, date }
//
// Where `accountNumber` is either an 18-digit CLABE or an alias (e.g. @name).

router.post('/api/transfer', async (req, res) => {
    const { username, accountNumber, email, amount, date } = req.body || {};

    // --- Validation ---
    if (!username || !accountNumber) {
        return res.json({ success: false, message: 'Missing required fields' });
    }
    var numericAmount = Number(amount);
    if (!isFinite(numericAmount) || numericAmount <= 0) {
        return res.json({ success: false, message: 'Invalid amount' });
    }

    const users = await jsonfile.readFile(usersFile);
    const transactions = await jsonfile.readFile(transactionsFile);
    const user = users.users.find(u => u.username === username);

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    // --- Activation gate (server-side) ---
    // Unactivated accounts cannot move money. The client also gates this
    // visually, but the server must enforce it independently.
    if (effectiveKycStatus(user) !== 'active') {
        return res.json({
            success: false,
            message: 'Account is not active'
        });
    }

    if (user.balance < numericAmount) {
        return res.json({ success: false, message: 'Insufficient balance' });
    }

    // --- Debit the sender ---
    user.balance -= numericAmount;

    // --- Record the transaction ---
    var reference = generateTransferReference();
    var record = {
        username: username,
        date: date || nowIso().split('T')[0],
        description: 'Transfer to ' + accountNumber + (email ? ' (' + email + ')' : ''),
        amount: numericAmount,
        status: 'Pending',
        reference: reference,
        createdAt: nowIso()
    };
    transactions.transactions.push(record);

    await jsonfile.writeFile(usersFile, users);
    await jsonfile.writeFile(transactionsFile, transactions);

    res.json({
        success: true,
        transaction: {
            reference: reference,
            amount: numericAmount,
            accountNumber: accountNumber,
            email: email || '',
            status: record.status,
            date: record.date
        }
    });
});

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------

router.get('/api/statement', async (req, res) => {
    const { username } = req.query;
    const users = await jsonfile.readFile(usersFile);
    const transactions = await jsonfile.readFile(transactionsFile);
    const user = users.users.find(u => u.username === username);
    if (!user) return res.json({ success: false });
    const userTransactions = transactions.transactions.filter(t => t.username === username);
    res.json({ success: true, balance: user.balance, transactions: userTransactions });
});

module.exports = router;
