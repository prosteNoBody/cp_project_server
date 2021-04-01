const express = require('express');
const session = require('express-session');
const cors = require('cors');
const MongoDBStore = require('connect-mongodb-session')(session);
const mongoose = require('mongoose');
const SteamUser = require("steam-user");
const SteamTotp = require('steam-totp');
const SteamCommunity = require('steamcommunity');
const TradeOfferManager = require('steam-tradeoffer-manager');
const passport = require("passport");
const SteamStrategy = require("passport-steam").Strategy;

const keys = require('./keys.json');
const dummyData = require('./dummydata.json');
const dummyUser = require('./dummyuser.json');

const store = new MongoDBStore({
    uri: keys.mongoUrl,
    collection: 'mobileApp'
})
const Schema = mongoose.Schema;
const UserScheme = new Schema({
    steamid: String,
    name: String,
    avatar: String,
    credit: Number,
    tradeUrl: String,
});
const OfferScheme = new Schema({
    id: String,
    trade_id: String,
    owner_id: String,
    buyer_id: String,
    items: [String],
    price: Number,
    date: String,
    status: Number,
});
const Offer = mongoose.model('offers', OfferScheme);
const User = mongoose.model('users', UserScheme);

const client = new SteamUser();
const community = new SteamCommunity();
const manager = new TradeOfferManager({
    steam: client,
    community: community,
    language: 'en',
});

passport.serializeUser((user, done) => done(null, user.steamid));
passport.deserializeUser((id, done) => {
    User.findOne({ steamid: id })
        .then(user => {
            done(null, user);
        });
});
passport.use(new SteamStrategy({
    returnURL: "http://localhost:3000/return",
    realm: "http://localhost:3000",
    apiKey: keys.steamApi,
}, (identifier, profile, done) => {
    /**
     * @param {Object} steamProfile - steam profile
     * @param {string} steamProfile.personaname - steam nickname
     * @param {string} steamProfile.avatarmedium - steam avatar
     */
    let steamProfile = profile._json;
    User.findOne({ steamid: steamProfile.steamid }).then(user => {
        if (user) {
            if (user.name !== steamProfile.personaname || user.avatar !== steamProfile.avatarmedium) {
                User.findOneAndUpdate({ steamid: user.steamid }, { name: steamProfile.personaname, avatar: steamProfile.avatarmedium }, { new: true })
                    .then(user => {
                        done(null, user);
                    })
            } else {
                done(null, user);
            }
        } else {
            new User({
                steamid: steamProfile.steamid,
                name: steamProfile.personaname,
                avatar: steamProfile.avatarmedium,
                credit: 0,
                tradeUrl: '',
            }).save().then((user) => {
                done(null, user);
            });
        }
    })
}));

const indexUsers = (users) => {
    let resUser = {};
    for (let user of users) {
        resUser[user.steamid] = {
            buyer_id: user.steamid,
            name: user.name,
            avatar: user.avatar,
        }
    }
    return resUser;
};

const app = express();
app.use(cors({
    preflightContinue: true,
    credentials: true,
}));
app.use(session({
    name: 'session_id',
    secret: 'secret_key',
    resave: true,
    saveUninitialized: true,
    rolling: true,
    cookie: {
        maxAge: 900000
    },
    store: store
}));
app.use(passport.initialize());
app.use(passport.session());

app.get(/^\/((login)|(return))$/, passport.authenticate('steam', { failureRedirect: '/' }), (req, res) => {
    res.redirect("/success");
});

app.get('/success', (req, res) => {
    res.send("successfully log-in");
});

app.get('/logout', (req, res) => {
    req.logout();
    res.send("successfully log-out");
});

app.use((req, res, next) => {
    if (!req.user) {
        return res.send({ requireLogIn: true });
    }
    next();
})

app.get('/bought', (req, res) => {
    res.send(dummyData);
    return;
    try {
        Offer.find({ buyer_id: req.user.steamid }).then(offers => {
            manager.getInventoryContents(570, 2, true, (error, inventory) => {
                if (error || typeof inventory == 'undefined') {
                    console.log(error);
                    res.send({ error: "Server error" });
                }
                inventory = inventory.map(item => {
                    if (!item.descriptions.length) {
                        item.descriptions = [{ type: "html", value: "No Descriptions" }];
                    }
                    return {
                        index: item.pos,
                        assetid: item.assetid,
                        name: item.market_name,
                        icon_url: item.getImageURL() + "200x200",
                        rarity: item.tags[1].name,
                        color: item.tags[1].color,
                        descriptions: item.descriptions,
                    };
                });
                User.find({}).then(users => {
                    users = indexUsers(users.map(user => {
                        return {
                            steamid: user.steamid,
                            name: user.name,
                            avatar: user.avatar,
                        };
                    }));
                    let resOffer = [];
                    for (let offer of offers) {
                        resOffer.push({
                            id: offer.id,
                            is_mine: offer.owner_id === req.user.steamid,
                            is_buyer: offer.buyer_id === req.user.steamid,
                            owner: users[offer.owner_id],
                            buyer_id: offer.buyer_id,
                            trade_id: offer.trade_id,
                            price: offer.price,
                            items: inventory.filter(item => offer.items.includes(item.assetid)),
                            date: offer.date,
                            status: offer.status,
                        })
                    }
                    res.send({ offers: resOffer });
                });
            })
        });
    } catch (e) {
        console.log(e);
        res.send("Error in loading owned offers")
    }
})
app.get('/owned', (req, res) => {
    res.send(dummyData);
    return;
    try {
        Offer.find({ owner_id: req.user.steamid }).then(offers => {
            manager.getInventoryContents(570, 2, true, (error, inventory) => {
                if (error || typeof inventory == 'undefined') {
                    console.log(error);
                    res.send({ error: "Server error" });
                }
                inventory = inventory.map(item => {
                    if (!item.descriptions.length) {
                        item.descriptions = [{ type: "html", value: "No Descriptions" }];
                    }
                    return {
                        index: item.pos,
                        assetid: item.assetid,
                        name: item.market_name,
                        icon_url: item.getImageURL() + "200x200",
                        rarity: item.tags[1].name,
                        color: item.tags[1].color,
                        descriptions: item.descriptions,
                    };
                });
                User.find({}).then(users => {
                    users = indexUsers(users.map(user => {
                        return {
                            steamid: user.steamid,
                            name: user.name,
                            avatar: user.avatar,
                        };
                    }));
                    let resOffer = [];
                    for (let offer of offers) {
                        resOffer.push({
                            id: offer.id,
                            is_mine: offer.owner_id === req.user.steamid,
                            is_buyer: offer.buyer_id === req.user.steamid,
                            owner: users[offer.owner_id],
                            buyer_id: offer.buyer_id,
                            trade_id: offer.trade_id,
                            price: offer.price,
                            items: inventory.filter(item => offer.items.includes(item.assetid)),
                            date: offer.date,
                            status: offer.status,
                        })
                    }
                    res.send({ offers: resOffer });
                });
            })
        });
    } catch (e) {
        console.log(e);
        res.send("Error in loading owned offers")
    }
})
app.get('/user', (req, res) => {
    res.send(dummyUser);
    return;
    res.send({
        name: req.user.name,
        avatar: req.user.avatar,
        credit: req.user.credit,
    })
})

mongoose.connect(keys.mongoUrl, { useUnifiedTopology: true, useNewUrlParser: true, useFindAndModify: false }).then(() => {
    console.log("DB - ONLINE");
}).catch(e => console.log(e));
client.logOn({
    accountName: keys.bot_username,
    password: keys.bot_password,
    twoFactorCode: SteamTotp.generateAuthCode(keys.bot_shared_secret, 1),
});
client.on('loggedOn', () => {
    console.log("STEAM BOT - ONLINE");
});
client.on('steamGuard', (domain, cb) => {
    cb(SteamTotp.generateAuthCode(keys.bot_shared_secret));
});
client.on('webSession', (id, session) => {
    manager.setCookies(session);
    community.setCookies(session);
});
app.listen(3000, err => {
    if (err) throw err;
    console.log("EXPRESS SERVER - ONLINE");
})