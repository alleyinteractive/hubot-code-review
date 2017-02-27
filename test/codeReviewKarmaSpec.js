/* eslint-env jasmine */

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
    displays the leaderboard
 * TODO:
    merge
    remove
 */

describe('Code Review Karma', () => {
  let robot = {};
  let adapter = {};
  let codeReviewKarma = {};

  /**
   * @const array List of Hubot User objects
   */
  let users = [];

  beforeEach((done) => {
    // create new robot, without http, using the mock adapter
    robot = new Robot(null, 'mock-adapter', true, 'hubot');

    robot.adapter.on('connected', () => {
      // create a user
      Users().getUsers().forEach((user) => {
        users.push(robot.brain.userForId(user.ID, {
          name: user.meta.name,
          room: user.meta.room,
        }));
      });

      // shuffle users for fun, variability, and profit
      users = util.shuffleArray(users);

      // load the module
      codeReviewKarma = require('../src/code-review-karma')(robot);
      adapter = robot.adapter;

      // start each test with an empty queue
      codeReviewKarma.flush_scores();
      // wait a sec for Redis
      setTimeout(() => {
        done();
      }, 150);
    });

    robot.run();
  });

  afterEach(() => {
    users = [];
    adapter = null;
    robot.server.close();
    robot.shutdown();
  });

  it('gives reviews', (done) => {
    codeReviewKarma.incr_score(users[0].name, 'give');
    expect(codeReviewKarma.scores_for_user(users[0].name).give).toBe(1);
    done();
  });

  it('takes reviews', (done) => {
    codeReviewKarma.incr_score(users[0].name, 'take');
    expect(codeReviewKarma.scores_for_user(users[0].name).take).toBe(1);
    done();
  });

  it('lists all cr scores', (done) => {
    codeReviewKarma.incr_score(users[1].name, 'give');
    codeReviewKarma.incr_score(users[1].name, 'give');
    codeReviewKarma.incr_score(users[1].name, 'take');

    util.sendMessageAsync(adapter, users[1].name, 'hubot list all cr scores',
      100,
      (envelope, strings) => {
        const expectString =
          `${users[1].name} has received 1 reviews and given 2. Code karma: 1`;
        expect(strings[0]).toBe(expectString);
        done();
      });
  });

  it('reports my score', (done) => {
    codeReviewKarma.incr_score(users[1].name, 'give');
    codeReviewKarma.incr_score(users[1].name, 'give');
    codeReviewKarma.incr_score(users[1].name, 'take');

    util.sendMessageAsync(adapter, users[1].name, 'hubot what is my cr score',
      100,
      (envelope, strings) => {
        const expectString =
          `${users[1].name} has received 1 reviews and given 2. Code karma: 1`;
        expect(strings[0]).toBe(expectString);
        done();
      });
  });

  it('reports someones else\'s score', (done) => {
    codeReviewKarma.incr_score(users[1].name, 'take');
    codeReviewKarma.incr_score(users[1].name, 'take');
    codeReviewKarma.incr_score(users[1].name, 'give');

    const queryString =
      `hubot what is ${users[1].name}'s cr score`;
    util.sendMessageAsync(adapter, users[0].name, queryString,
      100,
      (envelope, strings) => {
        const expectString =
          `${users[1].name} has received 2 reviews and given 1. Code karma: -0.5`;
        expect(strings[0]).toBe(expectString);
        done();
      });
  });

  it('displays the leaderboard', (done) => {
    // Give 3, Take 2
    codeReviewKarma.incr_score(users[0].name, 'give');
    codeReviewKarma.incr_score(users[0].name, 'give');
    codeReviewKarma.incr_score(users[0].name, 'give');
    codeReviewKarma.incr_score(users[0].name, 'take');
    codeReviewKarma.incr_score(users[0].name, 'take');
    // Give 2, Take 3
    codeReviewKarma.incr_score(users[1].name, 'take');
    codeReviewKarma.incr_score(users[1].name, 'take');
    codeReviewKarma.incr_score(users[1].name, 'take');
    codeReviewKarma.incr_score(users[1].name, 'give');
    codeReviewKarma.incr_score(users[1].name, 'give');
    // Give 2, Take 0
    codeReviewKarma.incr_score(users[2].name, 'give');
    codeReviewKarma.incr_score(users[2].name, 'give');

    util.sendMessageAsync(adapter, users[1].name, 'hubot what are the cr rankings?',
      100,
      (envelope, strings) => {
        const expectString =
          `${users[0].name} has done the most reviews with 3\n` +
          `${users[1].name} has asked for the most code reviews with 3\n` +
          `${users[2].name} has the best code karma score with 2`;

        expect(strings[0]).toBe(expectString);
        done();
      });
  });
});
