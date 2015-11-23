/* eslint no-console: 0, vars-on-top: 0 */
'use strict';

var _ = require('lodash');

/**
 * Applies reaping criteria to a project's containers.
 * Project must have or a .pull_requests and a .branches property set, depending on criteria.
 *
 * @param Project project - the project to apply criteria to
 * @param Object criteria - reaping criteria to apply.
 *
 * @returns Object - Object with .remove and .keep properties which are arrays of container ids.
 */
function applyCriteria(project, criteria) {
  var result = {
    remove: [], keep: []
  };

  if (!project || !criteria) {
    throw new TypeError('project and criteria are required.');
  }

  var pr_states = ['open', 'closed'];

  // Filter for PR states, must be one of 'open', 'closed'
  function state_filter(state) {
    if (pr_states.indexOf(state) < 0) {
      throw new TypeError(`state must be one of ${pr_states}, found: ${state}`);
    }

    // If a PR does not have a state it is assumed to be 'open'
    return function(pr) {
      var my_state = (pr.state && pr.state.state) || 'open';
      return my_state === state;
    };
  }

  if (criteria.pull_request) {
    for (let state of pr_states) {
      var state_criteria = criteria.pull_request[state];

      if (state_criteria && typeof state_criteria.max != 'undefined') {
        console.log(`Applying ${state.toUpperCase()} PR max: ${state_criteria.max}`);

        for (let pr of project.pull_requests.filter(state_filter(state))) {
          console.log('PR:', pr.pr);

          result = merge(result, applyMax(pr.builds, state_criteria.max));
        }
      }
    }
  }

  if (criteria.branch) {
    let max = criteria.branch.max;

    if (max) {
      console.log('Applying Branch max:', max);

      for (let branch of project.branches) {
        console.log('Branch:', branch.branch);

        result = merge(result, applyMax(branch.builds, max));
      }
    }
  }

  // map builds to container IDs
  function buildToContainerId(build) {
    return build.container.id;
  }
  result.remove = result.remove.map(buildToContainerId);
  result.keep = result.keep.map(buildToContainerId);

  return result;
}

/**
 * Merges two objects that have array properties together and removes duplicates in those arrays.
 * Each array element is assumed to be an object with an 'id' property, which is used for uniquenss tests.
 * @param Object existing - object to merge the other object into. Modified in place and returned.
 * @param Object current - new object to merge into existing object.
 *
 * @returns Object - the first argument ('existing')
 */
function merge(existing, current) {
  for (let key in current) {
    existing[key] = _.uniq(_.union(existing[key], current[key]), 'id');
  }
  return existing;
}

function applyMax(array, max) {
  if (!array) {
    throw new Error('Array argument required');
  }
  if (typeof max != 'number' || max < 0) {
    throw new Error('Invalid max pull requests criteria value: ' + max);
  }

  var ret = {
    remove: array.slice(max),
    keep: array.slice(0, max)
  };

  return ret;
}


module.exports = {
  apply: applyCriteria,
  // for testing:
  applyMax, merge
};
