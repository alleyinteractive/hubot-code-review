const Robot = require('../node_modules/hubot/src/robot');
const util = require('./lib/util');
const Users = require('./data/users');

/**
 * Tests the following features of code-review-karma
    gives reviews
    takes reviews
    lists all cr scores
    reports my score
    reports someones else's score
 * TODO:
    merge
    remove
    leaderboard
 */

describe('code-review-karma.coffee', function() {
  var robot;
  var adapter;
  var code_review_karma;

  /**
   * @var array List of Hubot User objects
   */
  var users = [];

  beforeEach(function(done) {

    // create new robot, without http, using the mock adapter
    robot = new Robot(null, "mock-adapter", true, "hubot");

    robot.adapter.on("connected", function() {

      // create a user
      Users().getUsers().forEach(function(user) {
        users.push(robot.brain.userForId(user.ID, {
          name: user.meta.name,
          room: user.meta.room
        }));
      });

      // shuffle users for fun, variability, and profit
      users = util.shuffleArray(users);

      // load the module
      code_review_karma = require("../src/code-review-karma")(robot);
      adapter = robot.adapter;

      // start each test with an empty queue
      code_review_karma.flush_scores();
      // wait a sec for Redis
      setTimeout(function() {
        done();
      }, 150);
    });

    robot.run();

  });

  afterEach(function() {
    users = [];
    adapter = null;
    robot.server.close();
    robot.shutdown();
  });

  it('gives reviews', function(done) {
    code_review_karma.incr_score(users[0].name, 'give');
    expect(code_review_karma.scores_for_user(users[0].name).give).toBe(1);
    done();
  });

  it('takes reviews', function(done) {
    code_review_karma.incr_score(users[0].name, 'take');
    expect(code_review_karma.scores_for_user(users[0].name).take).toBe(1);
    done();
  });

  it('lists all cr scores', function(done) {
    code_review_karma.incr_score(users[1].name, 'give');
    code_review_karma.incr_score(users[1].name, 'give');
    code_review_karma.incr_score(users[1].name, 'take');


    util.sendMessageAsync(adapter, users[1].name, 'hubot list all cr scores',
      100,
      function(envelope, strings) {
        const expectString =
          `${users[1].name} has received 1 reviews and given 2. Code karma: 1`;
        expect(strings[0]).toBe(expectString);
        done();
      });

  });

  it('reports my score', function(done) {
    code_review_karma.incr_score(users[1].name, 'give');
    code_review_karma.incr_score(users[1].name, 'give');
    code_review_karma.incr_score(users[1].name, 'take');


    util.sendMessageAsync(adapter, users[1].name, 'hubot what is my cr score',
      100,
      function(envelope, strings) {
        const expectString =
          `${users[1].name} has received 1 reviews and given 2. Code karma: 1`;
        expect(strings[0]).toBe(expectString);
        done();
      });

  });

  it("reports someones else's score", function(done) {
    code_review_karma.incr_score(users[1].name, 'take');
    code_review_karma.incr_score(users[1].name, 'take');
    code_review_karma.incr_score(users[1].name, 'give');

    const queryString =
      `hubot what is ${users[1].name}'s cr score`
    util.sendMessageAsync(adapter, users[0].name, queryString,
      100,
      function(envelope, strings) {
        const expectString =
          `${users[1].name} has received 2 reviews and given 1. Code karma: -0.5`;
        expect(strings[0]).toBe(expectString);
        done();
      });
  });

});
