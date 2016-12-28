'use strict';

/**
 *
 * All constants need to have a numerical
 * property called 'constant' and a
 * human-readable property called 'description'
 *
 */

module.exports = {};

module.exports.REAPED_REASON_UNKNOWN = {
  constant: 0,
  description: 'This build was deleted for an uknown reason.',
};

module.exports.REAPED_REASON_DISK_LIMIT = {
  constant: 1,
  description: 'This build was deleted to comply with your account limit.',
};

module.exports.REAPED_REASON_BRANCH_BUILDS = {
  constant: 2,
  description: 'This build was reaped because this branch has too many active builds.',
};

module.exports.REAPED_REASON_PR_BUILDS = {
  constant: 3,
  description: 'This build was reaped because this PR has too many active builds.',
};

module.exports.REAPED_REASON_PR_CLOSED = {
  constant: 4,
  description: 'This build was deleted because the PR was closed.',
};

module.exports.REAPED_REASON_MANUAL = {
  constant: 5,
  description: 'This build was manually deleted by a member of your team.',
};
