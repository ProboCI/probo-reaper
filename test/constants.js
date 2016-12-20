'use strict';

const _ = require('lodash');
const constants = require('../lib/constants');

/* eslint-disable no-unused-expressions */

describe('Constants', function() {
  it('should each have a numerical value and a readable value', function(done) {
    constants.should.be.a.Object;
    _.forEach(constants, function(c) {
      c.should.be.a.Object;
      c.should.have.property('constant').which.is.a.Number;
      c.should.have.property('description').which.is.a.String;
    });

    done();
  });
});
