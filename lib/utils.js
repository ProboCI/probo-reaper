'use strict';

var _ = require('lodash');
var bytes = require('bytes');

var utils = {

  /**
   * like lodash.indexBy, but instead of a single value, maps keys to an array of values.
   * @param {boolean} [single=false] - if true, uses the lodash implementation (resulting in single value per key)
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

  /**
   * Returns a sort function that sorts by descending order on 'field'
   * if dir is 'desc', ascending otherwise.
   *
   * Example usage:
   *  myArray.sort(utils.sorter('createdAt', 'desc'));
   *
   * @param {string} field - Object field name to sort on
   * @param {string} [dir='asc'] - Sort direction. 'desc' for descending, anything else for ascending.
   * @return {Function} - sorter function to pass to Array.sort.
   */
  sorter: function(field, dir) {
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

  printBuildsJSON(builds) {
    var out;
    for (let build of builds) {
      out = {
        id: build.id,
        provider: build.project.provider.slug,
        repo: build.project.slug,
        project: build.project.id,
        branch: build.branch,
        pr: build.pullRequest,
        prState: build._pr.state,
        conatainer: build.container.id,
        size: build.container.disk.containerSize || null,
        totalSize: build.container.disk.containerSize + build.container.disk.imageSize,
        state: build.container.state,
        created: build.createdAt,
        updated: build.updatedAt,
      };

      console.log(JSON.stringify(out));
    }
  }

  printBuilds(builds, indent) {
    if (this.opts.outputFormat === 'json') {
      return this.printBuildsJSON(builds);
    }

    indent = indent || '';
    for (let build of builds) {
      console.log(`${indent}Build ${build.id} ${build.createdAt} pr:${build.pullRequest} prState:${build._pr.state} branch:${build.branch} container:${build.container.state} size: ${bytes(build.container.disk.containerSize)}`);
    }
  }

  printPRs(pullRequests, indent) {
    indent = indent || '\t';
    for (let pr of pullRequests) {
      console.log(`${indent}PR ${pr.pr} state: ${pr.state || 'unknown'} [${pr.builds.length} builds] [total size: ${bytes(pr.totalBuildSize)}]`);
      this.printBuilds(pr.builds, indent + '\t');
    }
  }

  printBranches(branches, indent) {
    indent = indent || '\t';
    for (let branch of branches) {
      console.log(`\tBranch ${branch.branch} [${branch.builds.length} builds]`);
      this.printBuilds(branch.builds, indent + '\t');
    }
  }
};

module.exports = utils;
