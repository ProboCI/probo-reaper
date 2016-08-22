'use strict';

/*
Reaped Reason Codes
 1. Account over disk limit
 2. Too many builds on the branch
 3. Too many consecutive builds

*/

var REAPED_REASON_DISK_LIMIT = 1;
var REAPED_REASON_BRANCH_BUILDS = 1;
// var REAPED_REASON_CONSECUTIVE_BUILDS = 1;
// var REAPED_REASON_DISK_LIMIT = 1;

module.exports = {
  REAPED_REASON_DISK_LIMIT,
  REAPED_REASON_BRANCH_BUILDS,
};
