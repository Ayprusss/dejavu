const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const userRepo = require('../repositories/userRepo');
const env = require('../config/env');
const logger = require('../lib/logger');

/**
 * Addresses are stored lowercased and looked up on `lower(email)`, matching the
 * unique index from migration 0007. Before that, `A@x.com` and `a@x.com` were
 * two accounts and which one you logged into depended on your capitalisation.
 */
const normalizeEmail = (email) => email.trim().toLowerCase();

const register = async (req, res) => {
  const { email, password, firstName, lastName } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const existingUser = await userRepo.findByEmail(pool, normalizedEmail);

    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' });
    }
  } catch (error) {
    logger.error(
      { event: 'auth.register_lookup_failed', err: error },
      'Error checking for existing user',
    );
    return res.status(500).json({ message: 'Internal server error' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await userRepo.insert(pool, {
      email: normalizedEmail,
      passwordHash: hashedPassword,
      firstName,
      lastName,
      isAdmin: false,
    });

    // Guest orders are NOT linked here any more.
    //
    // Claiming every order that shared an email address meant anyone who knew a
    // buyer's address could register with it and inherit that buyer's order
    // history and shipping addresses — no verification, just registration.
    // POST /api/user/orders/claim replaces it: the customer presents the
    // `cs_...` session id from their own success page, which is evidence of the
    // purchase rather than a claim about it.

    const token = jwt.sign(
      { id: newUser.id, isAdmin: newUser.isAdmin },
      env.JWT_SECRET,
      {
        expiresIn: '24h',
      },
    );

    res.status(201).json({
      message: 'User Registered Successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        isAdmin: newUser.isAdmin,
      },
      token,
    });
  } catch (error) {
    logger.error(
      { event: 'auth.register_failed', err: error },
      'Error creating new user',
    );
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const user = await userRepo.findByEmail(pool, normalizeEmail(email));

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, isAdmin: user.isAdmin }, env.JWT_SECRET, {
      expiresIn: '24h',
    });

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isAdmin: user.isAdmin,
      },
      token,
    });
  } catch (error) {
    logger.error({ event: 'auth.login_failed', err: error }, 'Error logging in user');
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  register,
  login,
};
