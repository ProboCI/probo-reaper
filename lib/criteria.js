/* eslint no-console: 0, guard-for-in: 0 */
'use strict';

var _ = require('lodash');

var PR_STATES = ['open', 'closed'];
var PR_DEFAULT_STATE = 'open';


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
  let result = {
    remove: [], keep: [],
  };

  if (!project || !criteria) {
    throw new TypeError('project and criteria are required.');
  }

  if (criteria.pullRequest) {
    PR_STATES.forEach(function(state) {
      result = applyPullRequestCriteria(project, state, criteria, result);
    });
  }

  if (criteria.branch) {
    project.branches.forEach(function(branch) {
      result = applyBranchCriteria(project, branch, criteria, result);
    });
  }
  result.remove = result.remove.map(buildToContainerId);
  result.keep = result.keep.map(buildToContainerId);

  // ensure that if something is in 'keep', we remove it from 'remove'
  // because it's possible for a container to be in both.
  result.remove = _.difference(result.remove, result.keep);

  return result;
}

// Map builds to container IDs
function buildToContainerId(build) {
  return build.container.id;
}

function applyBranchCriteria(project, branch, criteria, result) {
  let max;
  try {
    max = criteria.branch.max;
  }
  catch (e) {
    return result;
  }

  if (!Number.isNaN(max)) {
    console.log('Applying Branch max:', max);
    console.log('Branch:', branch.branch);
    result = merge(result, applyMax(branch.builds, max));
  }
  return result;
}

function applyPullRequestCriteria(project, state, criteria, result) {
  let stateCriteria;
  let max;
  try {
    stateCriteria = criteria.pullRequest[state];
    max = Number(stateCriteria.max);
  }
  catch (e) {
    return result;
  }
  if (stateCriteria && !Number.isNaN(max)) {
    console.log(`Applying ${state.toUpperCase()} PR max: ${stateCriteria.max}`);

    let prsInState = project.pullRequests.filter(function(pr) {
      if (PR_STATES.indexOf(state) < 0) {
        throw new TypeError(`state must be one of ${PR_STATES}, found: ${state}`);
      }

      // If a PR does not have a state it is assumed to be in the default
      // state.
      let myState;
      try {
        myState = pr.state.state;
      }
      catch (e) {
        myState = PR_DEFAULT_STATE;
      }
      return myState === state;
    });

    prsInState.forEach(function(pr) {
      console.log('PR:', pr.pr, pr.state);
      result = merge(result, applyMax(pr.builds, stateCriteria.max));
    });
  }
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
  applyMax, merge,
};
