'use strict';

const _ = require('lodash');
const bytes = require('bytes');

var utils = {

  /**
   * This function returns an object with keys matching the value of the field named in the field argument.
   *
   * @param {array} array - An array of objects all of which must contain keys of the name field.
   * @param {string} field - The field whose values should be used for aggregates.
   * @return {Object} - Returns the composed aggregate object.
   */
  indexBy: function(array, field) {
    return array.reduce(function(accum, obj) {
      var key = obj[field];
      accum[key] = accum[key] || [];

      accum[key].push(obj);
      return accum;
    }, {});
  },

  /**
   * Returns a sort function.
   *
   * @return {function} A sort function to order builds by date desc.
   */
  sortBuildsByDateDesc: function cmp(a, b) {
    // Dates are strings. Make sure to do string comparision.
    var aDate = _.isEmpty(a.createdAt) ? '0' : a.createdAt;
    var bDate = _.isEmpty(b.createdAt) ? '0' : b.createdAt;
    var aPinned = !!a.pinned;
    var bPinned = !!b.pinned;

    function sortByDateDesc() {
      if (aDate < bDate) {
        return 1;
      }
      else if (aDate > bDate) {
        return -1;
      }
      return 0;
    }

    if (aPinned && bPinned) {
      return sortByDateDesc();
    }
    else if (!aPinned && !bPinned) {
      return sortByDateDesc();
    }
    else if (aPinned) {
      // A pinned and B is not. A has a higher priority...
      // Same effect as if A had a later date.
      return -1;
    }
    else {
      // B pinned and A is not. B has a higher priority...
      return 1;
    }
  },

  sortPRsByNumberDesc: function cmp(a, b) {
    var prA = isNaN(Number(a.pr)) ? 0 : Number(a.pr);
    var prB = isNaN(Number(b.pr)) ? 0 : Number(b.pr);

    if (prA < prB) {
      return 1;
    }
    else if (prA > prB) {
      return -1;
    }
    return 0;
  },

  slugify: {
    // pr is already just a number
    projectPr: function(project, pr) {
      return `${project.provider.slug}-${project.provider_id}-${pr}`;
    },
  },

  json: function(obj) {
    return JSON.stringify(obj, null, 2);
  },
};

utils.Printer = class Printer {

  /**
   * Printer for printing output in an appropriate format.
   * @class
   *
   * @param {object} options - Options..
   * @param {object} options.outputFormat - 'json' or 'text' (default)
   */
  constructor(options) {
    this.opts = options;
  }

  printProject(project) {
    console.log(`Project ${project.id} ${project.slug} [${project.provider.slug}]`);
  }

  printBuilds(builds, indent) {
    indent = indent || '';
    for (let build of builds) {
      const realSpace = (build.diskSpace && build.diskSpace.realBytes) ? build.diskSpace.realBytes : '';
      console.log(`${indent}Build ${build.id} ${build.createdAt} container: ${build.container.state} size: ${realSpace}`);
    }
  }

  printPRs(pullRequests, indent) {
    indent = indent || '\t';
    for (let prName in pullRequests) {
      let pr = pullRequests[prName];

      console.log(`${indent}PR ${pr.id} branch: ${prName} state: ${pr.state || 'unknown'} [${pr.builds.length} builds] [total size: ${bytes(pr.diskUsage)}]`);
      this.printBuilds(pr.builds, indent + '\t');
    }
  }

  printBranches(branches, indent) {
    indent = indent || '\t';
    for (let branchName in branches) {
      let branch = branches[branchName];

      console.log(`\tBranch ${branch.branch} [${branch.builds.length} builds]`);
      this.printBuilds(branch.builds, indent + '\t');
    }
  }
};

module.exports = utils;
