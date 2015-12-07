'use strict';

var _ = require('lodash');

var utils = {

  /**
   * like lodash.indexBy, but instead of a single value, maps keys to an array of values.
   * @param {boolean} [single=false] boolean - if true, uses the lodash implementation (resulting in single value per key)
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
      var valueA = typeof field == 'function' ? field(a) : a[field];
      var valueB = typeof field == 'function' ? field(b) : b[field];

      if (typeof valueA == 'undefined') valueA = 'undefined';
      if (typeof valueB == 'undefined') valueB = 'undefined';

      if (valueA < valueB) return dir === 'desc' ? 1 : -1;
      if (valueA === valueB) return 0;
      return dir === 'desc' ? -1 : 1;
    };
  },

  printBuilds: function(builds, indent) {
    indent = indent || '\t';
    for (let build of builds) {
      console.log(`${indent}Build ${build.id} ${build.createdAt} pr:${build.pullRequest} branch:${build.branch} container:${build.container.state}`);
    }
  },

  printPRs: function(pullRequests, indent) {
    indent = indent || '\t';
    for (let pr of pullRequests) {
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
  },
};

module.exports = utils;
