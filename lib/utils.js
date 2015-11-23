'use strict';

var _ = require('lodash');

var utils = {

  /**
   * like lodash.indexBy, but instead of a single value, maps keys to an array of values.
   * @param [single=false] boolean - if true, uses the lodash implementation (resulting in single value per key)
   */
  indexBy: function(array, field, single) {
    if (single) {
      return _.indexBy(array, field);
    }

    return array.reduce(function(accum, obj) {
      var key = obj[field];
      accum[key] = accum[key] || [];

      accum[key].push(obj);
      return accum;
    }, {});
  },

  sorter: function(field, dir) {
    // sorts by descending order if dir is 'desc', ascending otherwise
    return function cmp(a, b) {
      var value_a = typeof field == 'function' ? field(a) : a[field];
      var value_b = typeof field == 'function' ? field(b) : b[field];

      if (typeof value_a == 'undefined') value_a = 'undefined';
      if (typeof value_b == 'undefined') value_b = 'undefined';

      if (value_a < value_b) return dir === 'desc' ? 1 : -1;
      if (value_a === value_b) return 0;
      return dir === 'desc' ? -1 : 1;
    };
  },

  printBuilds: function(builds, indent) {
    indent = indent || '\t';
    for (let build of builds) {
      console.log(`${indent}Build ${build.id} ${build.createdAt} pr:${build.pullRequest} branch:${build.branch} container:${build.container.state}`);
    }
  },

  printPRs: function(pull_requests, indent) {
    indent = indent || '\t';
    for (let pr of pull_requests) {
      console.log(`${indent}PR ${pr.pr} state: ${pr.state ? pr.state.state : 'n/a'} [${pr.builds.length} builds]`);
      utils.printBuilds(pr.builds, indent + '\t');
    }
  },

  printBranches: function(branches, indent) {
    indent = indent || '\t';
    for (let branch of branches) {
      console.log(`\tBranch ${branch.branch} [${branch.builds.length} builds]`);
      utils.printBuilds(branch.builds, indent + '\t');
    }
  }
};

module.exports = utils;
