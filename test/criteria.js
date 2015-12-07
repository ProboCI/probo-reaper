/* eslint no-multi-spaces: 0, key-spacing: 0 */
'use strict';

// To test:
// 1 - max per branch
// 2 - max per open pull request
// 3 - max per closed pull request

var lib = require('../lib/criteria');

describe('criteria', function(done) {
  var projects;

  before('load projects', function() {
    projects = require('./fixtures/criteria_projects');
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

    let array = [1, 2, 3, 4, 5];
    applyMax(array,  0).should.eql({keep: [],              remove: [1, 2, 3, 4, 5]});
    applyMax(array,  1).should.eql({keep: [1],             remove: [2, 3, 4, 5]});
    applyMax(array,  2).should.eql({keep: [1, 2],          remove: [3, 4, 5]});
    applyMax(array,  5).should.eql({keep: [1, 2, 3, 4, 5], remove: []});
    applyMax(array, 10).should.eql({keep: [1, 2, 3, 4, 5], remove: []});
  });

  it('criteria gets applied correctly', function() {
    var project = projects[0];

    var criteria = {
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

    var applyCriteria = lib.apply;

    // missing criteria
    applyCriteria.bind(null, {}).should.throw('project and criteria are required.');

    applyCriteria(project, criteria).should.eql({
      remove: [
        'container 0',
        'container 6',
        'container 5',
        'container pre-3',
      ],
      keep: [
        'container 2',
        'container 1',
        'container 4',
        'container 3',
      ],
    });
  });
});
