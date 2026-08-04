'use strict';

const { getUserModel } = require('../models/user');

function formatUserLabel(user) {
  if (!user) return '';
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  if (name && user.email) return `${name} (${user.email})`;
  if (name) return name;
  return user.email || user.userName || '';
}

async function resolveUserLabel(userId, fallback = '') {
  const id = String(userId || '').trim();
  if (!id) return fallback || '';
  try {
    const User = await getUserModel();
    let user = null;
    if (/^[a-f0-9]{24}$/i.test(id)) {
      user = await User.findById(id).select('firstName lastName email userName').lean();
    }
    if (!user) {
      user = await User.findOne({
        $or: [{ email: id.toLowerCase() }, { userName: id }]
      })
        .select('firstName lastName email userName')
        .lean();
    }
    return formatUserLabel(user) || fallback || id;
  } catch (_) {
    return fallback || id;
  }
}

async function resolveUserLabelsMap(userIds = []) {
  const ids = [...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const out = new Map();
  await Promise.all(
    ids.map(async (id) => {
      out.set(id, await resolveUserLabel(id));
    })
  );
  return out;
}

module.exports = { formatUserLabel, resolveUserLabel, resolveUserLabelsMap };
