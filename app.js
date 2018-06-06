"use latest";
//#productTitle
//#priceblock-ourprice
//#priceblock-dealprice

import axios from 'axios';
import bodyParser from 'body-parser';
import express from 'express';
import Webtask from 'webtask-tools';
import {
    parallel
} from 'async';
import cheerio from 'cheerio';
import {
    MongoClient
} from 'mongodb';
import handlebars from 'handlebars';

const app = new express();

app.use(bodyParser.json());

const getAmazonProduct = (amazonProductId) =>
    axios.get(`https://www.amazon.com/dp/${amazonProductId}?psc=1`).then((response) => {
        if (response.status === 200) {
            const html = response.data;
            let c = cheerio.load(html);
            let productInfo = {
                title: c('#productTitle'),
                ourPrice: c('#priceblock_ourprice'),
                dealPrice: c('#priceblock_dealprice')
            };

            const responseData = Object.keys(productInfo)
                .map(key => [key, productInfo[key].text()])
                .filter(keyVal => keyVal[1])
                .map(keyVal => [keyVal[0], keyVal[1].replace(/\$/, "").trim().replace(/[\n\s\t]{2,}/g, ".")])
                .reduce((obj, keyVal) => {
                    obj[keyVal[0]] = keyVal[1];
                    return obj;
                }, {});
            return responseData;
        } else {
            return null;
        }
    }).catch((reason) => res.send(`ERROR FETCHING PRODUCT: \n${reason}`));

app.get('/add/:asin', (req, res) => {
    let amazonProductId = req.params.asin;
    getAmazonProduct(amazonProductId).then(responseData => {
        if (Object.keys(responseData).length > 0) {
            MongoClient.connect(req.webtaskContext.data.MONGO_URL).then((connection) => {
                let db = connection.db('pricewatch');
                db.collection('products').find({
                    amazonProductId: amazonProductId
                }).toArray().then((docs) => {
                    if (docs.length > 0) {
                        res.send('PRODUCT ALREADY EXISTS');
                    } else {
                        db.collection('products').insert({
                            amazonProductId: amazonProductId,
                            title: responseData.title,
                            prices: [{
                                date: (new Date()).toISOString(),
                                price: responseData.dealPrice || responseData.ourPrice
                            }]
                        }, (err) => {
                            if (err) return res.send(err);
                            res.send('SUCCESS');
                        });
                    }
                }).catch((reason) => res.send(`ERROR SEARCHING DB: \n${reason}`));
            }).catch((reason) => res.send(`ERROR CONNECTING TO MONGODB: \n${reason}`));
        }
    });
});

app.get('/update', (req, res) => {
    MongoClient.connect(req.webtaskContext.data.MONGO_URL).then((connection) => {
        let db = connection.db('pricewatch');
        db.collection('products').find({}).toArray().then((docs) => {
            if (docs.length == 0) {
                return res.send('SUCCESS - NO PRODUCTS');
            }
            const docUpdates = docs.map((doc) => {
                return getAmazonProduct(doc.amazonProductId).then((responseData) => {
                    doc.prices.push({
                        date: (new Date()).toISOString(),
                        price: responseData.dealPrice || responseData.ourPrice
                    });
                    return new Promise((resolve, reject) => {
                        db.collection('products').updateOne({
                            amazonProductId: doc.amazonProductId
                        }, {
                            $set: {
                                prices: doc.prices
                            }
                        }, (error) => {
                            if (error) reject(error);
                            resolve();
                        });
                    });
                });
            });
            Promise.all(docUpdates).then(() => {
                res.send('SUCCESS');
            }).catch(reason => res.send(`ERROR UPDATING DB: \n${reason}`));
        }).catch((reason) => res.send(`ERROR FETCHING ITEMS FROM DB: \n${reason}`));
    }).catch((reason) => res.send(`ERROR CONNECTING TO MONGODB: \n${reason}`));
});


var View = `
<html>
  <head>
    <title>Best Amazon Prices</title>
  </head>
  <body>
    {{#if products.length}}
      <ul>
        {{#each products}}
          <li><a href="https://www.amazon.com/dp/{{amazonProductId}}">{{title}}</a>: {{bestPrice.price}} (on {{bestPrice.date}})</li>
        {{/each}}
      </ul>
    {{else}}
      <h1>No products!</h1>
    {{/if}}
  </body>
</html>
`;
const template = handlebars.compile(View);

app.get('/', (req, res) => {
    MongoClient.connect(req.webtaskContext.data.MONGO_URL).then((connection) => {
        let db = connection.db('pricewatch');
        db.collection('products').find({}).toArray().then((docs) => {
            const view_ctx = {
                products: docs.map(doc => ({
                    amazonProductId: doc.amazonProductId,
                    title: doc.title,
                    bestPrice: doc.prices.reduce((acc, priceDate) => acc.price > priceDate.price ? { price: priceDate.price, date: new Date(priceDate.date).toDateString() } : acc, {price: Number.POSITIVE_INFINITY})
                }))
            };
            res.writeHead(200, {
                'Content-Type': 'text/html'
            });
            res.end(template(view_ctx));
        }).catch(reason => res.send(`ERROR FETCHING ITEMS FROM DB: \n${reason}`));
    }).catch((reason) => res.send(`ERROR CONNECTING TO MONGODB: \n${reason}`));
})

module.exports = Webtask.fromExpress(app);