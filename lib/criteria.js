/* eslint no-console: 0, guard-for-in: 0 */
'use strict';

var _ = require('lodash');

/**
 * Applies reaping criteria to a project's containers.
 * Project must have or a .pullRequests and a .branches property set, depending on criteria.
 *
 * @param Project project - the project to apply criteria to
 * @param Object criteria - reaping criteria to apply.
 *
 * @returns Object - Object with .remove and .keep properties which are arrays of container ids.
 */
function applyCriteria(project, criteria) {
  var result = {
    remove: [], keep: [],
  };

  if (!project || !criteria) {
    throw new TypeError('project and criteria are required.');
  }

  var prStates = ['open', 'closed'];

  // Filter for PR states, must be one of 'open', 'closed'
  function stateFilter(state, defaultState) {
    defaultState = defaultState || 'open';

    var validStates = prStates.concat([defaultState]);
    if (validStates.indexOf(state) < 0) {
      throw new TypeError(`state must be one of ${validStates}, found: ${state}`);
    }

    // If a PR does not have a state it is assumed to be 'open' if no other default is specified
    return function(pr) {
      var myState = pr.state || defaultState;
      return myState === state;
    };
  }

  if (criteria.pullRequest) {
    for (let state of prStates) {
      let stateCriteria = criteria.pullRequest[state];

      if (stateCriteria && typeof stateCriteria.max != 'undefined') {
        console.log(`Applying ${state.toUpperCase()} PR max: ${stateCriteria.max}`);

        for (let pr of project.pullRequests.filter(stateFilter(state), 'open')) {
          console.log('PR:', pr.pr, pr.state);

          result = merge(result, applyMax(pr.builds, stateCriteria.max));
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

  // ensure that if something is in 'keep', we remove it from 'remove'
  // because it's possible for a container to be in both.
  result.remove = _.difference(result.remove, result.keep);

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
    keep: array.slice(0, max),
  };

  return ret;
}


module.exports = {
  apply: applyCriteria,
  // for testing:
  applyMax, merge,
};
