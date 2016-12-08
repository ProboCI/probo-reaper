'use strict';

/**
 *
 * Reaped Reason Codes
 *  0. Unknown
 *  1. Account over disk limit
 *  2. Too many builds on the branch
 *  3. Too many builds on the PR
 *  4. The PR is closed
 *  5. A manual deletion
 *
 */

const REAPED_REASON_UNKNOWN = 0;
const REAPED_REASON_DISK_LIMIT = 1;
const REAPED_REASON_BRANCH_BUILDS = 2;
const REAPED_REASON_PR_BUILDS = 3;
const REAPED_REASON_PR_CLOSED = 4;
const REAPED_REASON_MANUAL = 5;

module.exports = {
  REAPED_REASON_UNKNOWN,
  REAPED_REASON_DISK_LIMIT,
  REAPED_REASON_BRANCH_BUILDS,
  REAPED_REASON_PR_BUILDS,
  REAPED_REASON_PR_CLOSED,
  REAPED_REASON_MANUAL,
};
