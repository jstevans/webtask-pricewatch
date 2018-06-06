### webtask-pricewatch
A little service I wrote to familiarize myself with [webtask](https://webtask.io). It scrapes Amazon product pages for prices, and keeps track of the dates with the best prices for each product.

### Setup
1. Create a MongoDB instance with a database named 'pricewatch' and a collection named 'products'
2. `wt create --secret MONGO_URL=<MY_MONGODB_URL> app.js`

### APIs
`GET /add/:amazonProductId` will track an Amazon product page for its price, if it wasn't being tracked before.

`GET /update` will get the latest prices for all existing tracked products.

`GET /` will show a page with the best prices (and the dates they occurred) for all tracked products.