require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const ejs = require("ejs");
const bodyparser = require("body-parser");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const randomstring = require("randomstring");
const findorcreate = require("mongoose-findorcreate");
const Parser=require("json2csv");

const app = express();
app.use(bodyparser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.use(
  session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());

mongoose.connect(
  process.env.MONGOURL,
  { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false },
  (err) => {
    if (!err) {
      console.log("Connected To DB 👍");
    } else {
      console.log("Some Problem Occured While Connecting to Db 👎");
    }
  }
);
mongoose.set("useCreateIndex", true);

const userSchema = mongoose.Schema({
  username: String,
  googleId: String,
  name: String,
  profilepic: String,
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findorcreate);

const User = new mongoose.model("User", userSchema);

passport.use(User.createStrategy());

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: process.env.CALLBACKURL,
    },
    function (accessToken, refreshToken, profile, cb) {
      User.findOrCreate(
        {
          username: profile.emails[0].value,
          googleId: profile.id,
          name: profile.displayName,
          profilepic: profile.photos[0].value,
        },
        function (err, user) {
          //console.log(profile);
          return cb(err, user);
        }
      );
    }
  )
);

const user = mongoose.Schema({
  name: { type: String, required: true },
  registration: { type: String, required: true },
  email: { type: String, required: true },
  datetime: { type: Date, required: true },
});

const classschema = mongoose.Schema({
  classname: { type: String, required: true },
  classcode: { type: String, unique: true, required: true },
  createdon: { type: Date, required: true },
  email: { type: String, required: true },
  attendes: { type: [user], unique: false },
});

const Class = mongoose.model("Class", classschema);

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect("/auth/google");
}

app.route("/").get((req, res) => {
  res.render("index");
});

app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/attendancecall",
  passport.authenticate("google", { failureRedirect: "/login" }),
  function (req, res) {
    // Successful authentication, redirect home.
    res.redirect(req.session.returnTo || "/");
    delete req.session.returnTo;
  }
);

app.route("/login").get((req, res) => {
  res.render("login");
});

app
  .route("/dashboard")
  .get(ensureAuthenticated, (req, res) => {
    res.render("teacherdashboard", {
      name: req.user.name,
      pic: req.user.profilepic,
    });
  })
  .post(ensureAuthenticated, (req, res) => {
    // const u ={
    //     name:"ashish",
    // registration:"180101120056",
    // email:"akashish908@gmail.com",
    // datetime:new Date()

    // }
    const ob = new Class({
      classname: req.body.classname,
      classcode: randomstring.generate(7),
      createdon: new Date(),
      email: req.user.username,
    });
    ob.save();

    // console.log(req.body);
    // console.log(randomstring.generate(7));
    res.json(ob);
  });

app.get("/studentdashboard", ensureAuthenticated, (req, res) => {
  res.render("studentdashboard", {
    name: req.user.name,
    pic: req.user.profilepic,
  });
});

app.get("/getallclasslist", ensureAuthenticated, (req, res) => {
  Class.find({}, null, { sort: { createdon: -1 } }, (err, allclasses) => {
    if (!err) {
      if (allclasses) {
        res.json(allclasses);
        //res.render("teacherdashboard",{cl:allclasses});
      } else {
        res.json([]);
        //res.render("teacherdashboard",{cl:[]});
      }
    } else {
      res.status(404).json([{ error: "error Occured" }]);
    }
  });
});

app.get("/viewattendancelist/:classcode", ensureAuthenticated, (req, res) => {
  const code = req.params.classcode;
  Class.findOne({ classcode: code }, (err, listofattende) => {
    if (!err) {
      if (listofattende && listofattende.length != 0) {
        console.log(listofattende);
        res.render("viewattendlist", { alldetail: listofattende });
      } else {
        res.status(404);
      }
    } else {
      res.status(404);
    }
  });
});

app.post("/presentsir/:code", ensureAuthenticated, (req, res) => {
  const u = {
    name: req.user.name,
    registration: req.body.regno,
    email: req.user.username,
    datetime: new Date(),
  };
  const code = req.params.code;
  Class.findOne({ classcode: req.params.code }, (err, foundclass) => {
    if (!err) {
      if (foundclass) {
        var i = 0;

        //console.log(new Date() - timeOfClassCreation);
        //console.log(foundclass.attendes);
        foundclass.attendes.forEach((x) => {
          //console.log(x.email);
          if (x.email === req.user.username) {
            res.status(404).json({ error: false });
            i++;
          }
        });
        if (i === 0) {
          var timeOfClassCreation = foundclass.createdon;
          if (new Date() - timeOfClassCreation > process.env.MAXTIMEINMS) {
            console.log("time Is over");
            res.json({ error: "notintime" });
          } else {
            console.log("Under Maximum Time.");
            Class.findOneAndUpdate(
              { classcode: req.params.code },
              {
                $push: {
                  attendes: {
                    name: req.user.name,
                    registration: req.body.regno,
                    email: req.user.username,
                    datetime: new Date(),
                  },
                },
              },
              (err, foundcode) => {
                if (!err) {
                  if (foundcode) {
                    res.json(foundcode);
                  } else {
                    res.json({ error: true });
                  }
                } else {
                  res.status(404).json(err);
                }
              }
            );
          }
        }
      } else {
        //console.log(`Not Found any Class ${req.params.code}`);
        res.status(404).json({ error: true });
      }
    }
  });
});

const downloadResource = (res, fileName, fields, data) => {
  const json2csv = new Parser({ fields });
  const csv = json2csv.parse(data);
  res.header('Content-Type', 'text/csv');
  res.attachment(fileName);
  return res.send(csv);
}

app.get("/download/:code",(req,res)=>{
  Class.findOne({classcode:req.params.code},{attendes:1,_id:0},(err,classatten)=>{
    if(!err)
    {
      if(classatten)
      {
        console.log(classatten);
        const fields = ['name', 'registration', 'email','datetime'];
        const opts = { fields };
        return downloadResource(res, 'users.csv', opts, classatten);
      }
    }
  })
})

app.get("/logout", function (req, res) {
  req.logout();
  res.redirect("/login");
});

var port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Attendance Taker Started at ${port}`);
});
