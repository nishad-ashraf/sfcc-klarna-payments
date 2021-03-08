var page = module.superModule; // inherits functionality
var server = require('server');
var BasketMgr = require('dw/order/BasketMgr');
var KlarnaSessionManager = require('*/cartridge/scripts/common/klarnaSessionManager');

server.extend(page);

server.append('Begin', function (req, res, next) {
    var currentBasket = BasketMgr.getCurrentBasket();
    var viewData = res.getViewData();

    var klarnaSessionManager = new KlarnaSessionManager();

    klarnaSessionManager.createOrUpdateSession();

    viewData.klarna = {
        currency: currentBasket.getCurrencyCode()
    };
    viewData.klarnaForm = server.forms.getForm('klarna');

    return next();
});

module.exports = server.exports();
