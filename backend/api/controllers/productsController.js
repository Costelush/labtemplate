'use strict';

const minioService = require('../services/minioService'),
    esService = require('../services/esService'),
    productUtils = require('../utils/productUtils'),
    esConstants = require('../utils/esConstants.json'),
    validationUtils = require('../utils/validationUtils'),
    uuidv4 = require('uuid/v4');

exports.listProducts = function (req, res) {
    esService.searchProducts(req.query.q, req.query.from, req.query.size)
        .then((response, error) => {
            if (error)
                res.status(500).json(error);

            let hits = productUtils.convertHitsImageKeysToUrls(response.hits.hits).map(hit => hit._source);
            if (hits)
                res.status(200).json({
                    hits: hits,
                    total: response.hits.total
                });
            else res.status(204).send();
        });
};

exports.listProductsByUserUid = function (uid, from, size) {
    let q = esConstants.USER_UID_FIELD + esConstants.ES_EQUALS + uid;
    return esService.searchProducts(q, from, size)
        .then((response, error) => {
            if (error)
                res.status(500).json(error);

            let hits = productUtils.convertHitsImageKeysToUrls(response.hits.hits).map(hit => hit._source);
            if (hits)
                return {
                    hits: hits,
                    total: response.hits.total
                };
        });
};

exports.listUserProducts = function (req, res) {
    exports.listProductsByUserUid(req.params.userUid, req.query.from, req.query.size)
        .then((response, e) => {
            if (e)
                res.status(500).json(error);
            if (response)
                res.status(200).json(response);
        });
};

exports.listCurrentUserProducts = function (req, res) {
    exports.listProductsByUserUid(req.session.user.uid, req.query.from, req.query.size)
        .then((response, e) => {
            if (e)
                res.status(500).json(error);
            if (response)
                res.status(200).json(response);
        });
};

exports.createProduct = function (req, res) {
    let productUid = uuidv4();
    let s3Objects = productUtils.getS3Objects(productUid, req.files);
    s3Objects.forEach(element => minioService.uploadProductImage(element.key, element.data))

    let product = {
        uid: productUid,
        userUid: req.session.user.uid,
        name: req.body.name,
        unit: req.body.unit,
        description: req.body.description,
        category: req.body.category,
        quantity: req.body.quantity ? parseInt(req.body.quantity) : req.body.quantity,
        price: parseFloat(req.body.price),
        images: s3Objects.map(object => object.key),
        created: Date.now(),
    };

    esService.indexProduct(product)
        .then((response, error) => {
            if (error)
                res.status(500).json(error);
            console.log("Product " + product.uid + " indexed.");
            res.json(response);
        }).catch(error => {
            res.status(500).json(error);
            console.error(error);
        });
};

exports.getProduct = function (req, res) {
    let q = esConstants.UID_FIELD + esConstants.ES_EQUALS + req.params.productUid;
    esService.searchProducts(q)
        .then((response, error) => {
            if (error)
                res.status(500).json(error);
            response.hits.hits = productUtils.convertHitsImageKeysToUrls(response.hits.hits)
            if (response.hits.hits)
                res.status(200).json(response.hits.hits[0]._source);
            else res.status(204).send();
        });
};

exports.updateProduct = function (req, res) {
    let q = esConstants.UID_FIELD + esConstants.ES_EQUALS + req.params.productUid;
    esService.searchProducts(q)
        .then((response, error) => {
            if (error)
                res.status(500).json(error);
            if (!response.hits.hits.length)
                res.status(404).send();
            else return esService.updateProduct(response.hits.hits[0]._id, validationUtils.validateProduct(req.body));
        }).then((response, error) => {
            if (error)
                res.status(500).json(error);
            if (response)
                res.status(200).json(response);
        });
};

exports.deleteProduct = function (req, res) {
    let q = esConstants.UID_FIELD + esConstants.ES_EQUALS + req.params.productUid;
    esService.searchProducts(q)
        .then((response, error) => {
            if (error)
                res.status(500).json(error);
            return response.hits.hits[0];
        }).then(product => {
            esService.deleteProduct(product._id);
            return product._source;
        }).then((product, error) => {
            if (error)
                res.status(500).json(error);
            else if (product) {
                product.images.forEach(imageKey => minioService.deleteProductImage(imageKey));
                res.status(200).send();
            }
        }).catch(e => res.status(500).json(e));
};