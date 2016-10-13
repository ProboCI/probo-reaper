/* eslint no-multi-spaces: 0, key-spacing: 0 */
'use strict';
var _ = require('lodash');

// To test:
// 1 - max per branch
// 2 - max per open pull request
// 3 - max per closed pull request

var lib = require('../lib/criteria');

describe('criteria functionality', function(done) {
  var testProject;

  before('load projects', function() {
    testProject = require('./fixtures/criteria_projects.json');
  });

  it('merges results objects properly', function() {
    var result = {
      array1: [{id: 'one'}], array2: [],
    };

    var ret = lib.merge(result, {
      array1: [{id: 'two'}, {id: 'one'}], array2: [{id: 'three'}],
    });

    ret.should.eql({
      array1: [{id: 'one'}, {id: 'two'}], array2: [{id: 'three'}],
    });

    ret.should.eql(result);
  });

  it('applies max value to an array correctly', function() {
    var applyMax = lib.applyMax;

    applyMax.bind(null).should.throw('Array argument required');
    applyMax.bind(null, []).should.throw('Invalid max pull requests criteria value: undefined');
    applyMax.bind(null, [], 'string').should.throw('Invalid max pull requests criteria value: string');
    applyMax.bind(null, [], -1).should.throw('Invalid max pull requests criteria value: -1');

    applyMax.bind(null, [], 0).should.not.throw();
    applyMax.bind(null, [], 3).should.not.throw();

    let array = _.map([1, 2, 3, 4, 5], function(num) {
      return {id: num};
    });

    let getObjId = function(obj) {
      return obj.id;
    };

    _.map(applyMax(array, 0).keep, getObjId)
      .should.eql([]);

    _.map(applyMax(array, 0).remove, getObjId)
      .should.eql([1, 2, 3, 4, 5]);

    _.map(applyMax(array, 1).keep, getObjId)
      .should.eql([1]);

    _.map(applyMax(array, 1).remove, getObjId)
      .should.eql([2, 3, 4, 5]);

    _.map(applyMax(array, 2).keep, getObjId)
      .should.eql([1, 2]);

    _.map(applyMax(array, 2).remove, getObjId)
      .should.eql([3, 4, 5]);

    _.map(applyMax(array, 5).keep, getObjId)
      .should.eql([1, 2, 3, 4, 5]);

    _.map(applyMax(array, 5).remove, getObjId)
      .should.eql([]);

    _.map(applyMax(array, 10).keep, getObjId)
      .should.eql([1, 2, 3, 4, 5]);

    _.map(applyMax(array, 10).remove, getObjId)
      .should.eql([]);
  });

  it('applies criteria correctly', function() {
    let criteria = {
      pullRequest: {
        open: {
          max: 2,
        },
        closed: {
          max: 0,
        },
      },
      branch: {
        max: 2,
      },
    };

    let applyCriteria = lib.apply;

    // Missing criteria
    applyCriteria.bind(null, {}).should.throw('project and criteria are required.');

    let actions = applyCriteria(testProject, criteria);
    actions.remove.map(function(obj) {
      return obj.container.id;
    })
    .should.eql([
      'container 0',
      'container 6',
      'container 5',
      'container pre-3',
    ]);

    actions.keep.map(function(obj) {
      return obj.container.id;
    })
    .should.eql([
      'container 2',
      'container 1',
      'container 4',
      'container 3',
    ]);
  });
});
