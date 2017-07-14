var express = require("express");
var router = express.Router();
var request = require("request")
var repositoryModel = require("../model/repository.js");
var crypter = require("../util/crypter.js");
var generator = require("../backend/generator.js");
var deploy = require("../backend/deploy.js");
var commitWatcher = require("../util/commitWatcher.js");
router.get('/register', function (req, res, next) {
  var query = `ci=true&username=${req.session.username}`;
  res.redirect(`/?${query}`);
})

router.post('/register', function (req, res, next) {

  var repositoryName = req.body.repository;
  request({
    url: `https://api.github.com/repos/${req.session.username}/${repositoryName}/hooks?access_token=${req.session.token}`,
    headers: {
      'User-Agent': 'request'
    }
  }, function (error, response, body) {
    var hooks = JSON.parse(body);
    var hookurl = process.env.HOSTNAME + '/ci/webhook'
    var isRegistered = false;
    hooks.forEach(function (hook) {
      if (hook.config.url == hookurl) {
        isRegistered = true
      }
    })
    if (!isRegistered) {
      request({
        url: `https://api.github.com/repos/${req.session.username}/${repositoryName}/hooks?access_token=${req.session.token}`,
        headers: {
          'User-Agent': 'request'
        },
        method: 'POST',
        json: {
          name: "web",
          active: true,
          events: [
            "push"
          ],
          config: {
            url: hookurl,
            content_type: "json"
          }
        }
      }, function(error, response, body) {
        repositoryModel.newRepository(repositoryName,
          req.session.username,
          req.session.githubId,
          crypter.encrypt(req.session.token),
          req.session.email)
          .then(function(result) {
            res.redirect("/?message=1");
          })
          .catch(function(err) {
            next({
              status: 500,
              message: 'Something went wrong.'
            })
          })
      })
    } else {
      res.redirect("/?message=2");
    }
  })
})

router.post('/webhook', function(req, res, next) {
  var event = req.get('X-GitHub-Event');
  var branch = req.body.ref.split("/")[2];
  if (branch !== "gh-pages") {
    switch (event) {
      case "push":
      let sha = req.body.head_commit.id;
      let username = req.body.repository.full_name.split("/")[0];
      let repoName = req.body.repository.name;
      let formats = ['.md', '.rst'];
      commitWatcher.docChanged(sha, username, repoName, formats)
      .then(function (changed) {
        if (changed) {
          repositoryModel.findOneRepository(
            {
              githubId: req.body.repository.owner.id,
              name: req.body.repository.name
            }
          ).
          then(function(result) {
            var data = {
              email: result.email,
              gitUrl: req.body.repository.clone_url,
              docTheme: "",
            }
            generator.executeScript({}, data, function(err, generatedData) {
              if (err) {
                console.log(err);
              } else {
                deploy.deployPages({}, {
                  email: result.email,
                  gitURL: req.body.repository.clone_url,
                  username: result.username,
                  uniqueId: generatedData.uniqueId,
                  encryptedToken: result.accessToken
                })
              }
            })
          })
          .catch(function (err) {
            console.log(err);
            res.json({
              status: true
            })
          })
        } else {
          res.json({
            status: false,
            description: "Documentation files didn't changed"
          })
        }
      })
      .catch(function (err) {
        next({
          status: 500,
          message: 'Something went wrong.'
        })
      })
        break;
      default:
        res.json({
          status: false,
          description: 'undefined event'
        })
    }
  } else {
    res.json({
      status: false,
      description: "invalid branch"
    })
  }
})

module.exports = router;
