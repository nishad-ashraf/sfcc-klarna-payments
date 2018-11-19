/* globals empty */

(function () {
    'use strict';

    var URLUtils = require('dw/web/URLUtils');
    var Site = require('dw/system/Site');
    var Logger = require('dw/system/Logger');
    var HookMgr = require('dw/system/HookMgr');

    var log = Logger.getLogger('KlarnaPaymentsOrderRequestBuilder.js');

    var Builder = require('~/cartridge/scripts/common/Builder');
    var CONTENT_TYPE = require('~/cartridge/scripts/util/KlarnaPaymentsConstants.js').CONTENT_TYPE;

    var KlarnaPaymentsOrderModel = require('~/cartridge/scripts/klarna_payments/model/request/order').KlarnaPaymentsOrderModel;

    var AddressRequestBuilder = require('~/cartridge/scripts/klarna_payments/requestBuilder/address');
    var OrderLineItemRequestBuilder = require('~/cartridge/scripts/klarna_payments/requestBuilder/orderLineItem');
    var ShipmentItemRequestBuilder = require('~/cartridge/scripts/klarna_payments/requestBuilder/shipmentItem');
    var PriceAdjustmentRequestBuilder = require('~/cartridge/scripts/klarna_payments/requestBuilder/priceAdjustment');
    var GiftCertificatePIRequestBuilder = require('~/cartridge/scripts/klarna_payments/requestBuilder/giftCertificatePI');
    var SalesTaxRequestRequestBuilder = require('~/cartridge/scripts/klarna_payments/requestBuilder/salesTax');
    var AdditionalCustomerInfoRequestBuilder = require('~/cartridge/scripts/klarna_payments/requestBuilder/additionalCustomerInfo');

    /**
     * KP Order Request Builder
     */
    function KlarnaPaymentsOrderRequestBuilder() {
        this.addressRequestBuilder = new AddressRequestBuilder();
        this.orderLineItemRequestBuilder = new OrderLineItemRequestBuilder();
        this.shipmentItemRequestBuilder = new ShipmentItemRequestBuilder();
        this.priceAdjustmentRequestBuilder = new PriceAdjustmentRequestBuilder();
        this.giftCertificatePIRequestBuilder = new GiftCertificatePIRequestBuilder();
        this.salesTaxRequestBuilder = new SalesTaxRequestRequestBuilder();
        this.additionalCustomerInfoRequestBuilder = new AdditionalCustomerInfoRequestBuilder();

        this.context = null;
        this.localeObject = null;
        this.params = null;
    }

    KlarnaPaymentsOrderRequestBuilder.prototype = new Builder();

    KlarnaPaymentsOrderRequestBuilder.prototype.getAddressRequestBuilder = function () {
        return this.addressRequestBuilder;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.getOrderLineItemRequestBuilder = function () {
        return this.orderLineItemRequestBuilder;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.getShipmentItemRequestBuilder = function () {
        return this.shipmentItemRequestBuilder;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.getPriceAdjustmentRequestBuilder = function () {
        return this.priceAdjustmentRequestBuilder;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.getGiftCertificatePIRequestBuilder = function () {
        return this.giftCertificatePIRequestBuilder;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.getSalesTaxRequestBuilder = function () {
        return this.salesTaxRequestBuilder;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.getAdditionalCustomerInfoRequestBuilder = function () {
        return this.additionalCustomerInfoRequestBuilder;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.setParams = function (params) {
        this.validateParams(params);

        this.setLocaleObject(params.localeObject.custom);

        this.params = params;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.setLocaleObject = function (localeObject) {
        this.localeObject = localeObject;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.getLocaleObject = function () {
        return this.localeObject;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.init = function () {
        this.context = new KlarnaPaymentsOrderModel();

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.setMerchantReference = function (order) {
        this.context.merchant_reference1 = order.orderNo;
        this.context.merchant_reference2 = '';

        if (Site.getCurrent().getCustomPreferenceValue('merchant_reference2_mapping')) {
            try {
                this.context.merchant_reference2 = order[Site.getCurrent().getCustomPreferenceValue('merchant_reference2_mapping')].toString();
            } catch (err) {
                log.error('merchant_reference2 was not set. Error: {0} ', err.message);
            }
        }

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildBilling = function (basket) {
        this.context.billing_address = this.getAddressRequestBuilder().build(basket);

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildShipping = function (basket) {
        this.context.shipping_address = this.getAddressRequestBuilder().build(basket);

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildLocale = function (order) {
        var localeObject = this.getLocaleObject();
        var currency = order.getCurrencyCode();

        this.context.purchase_country = localeObject.country;
        this.context.purchase_currency = currency;
        this.context.locale = localeObject.klarnaLocale;

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildOrderLines = function (order) {
        var lineItems = order.getAllProductLineItems().toArray();
        var giftCertificates = order.getGiftCertificateLineItems().toArray();
        var giftCertificatePIs = order.getGiftCertificatePaymentInstruments().toArray();
        var shipments = order.shipments;

        this.buildItems(lineItems, this.context);

        if (giftCertificates.length > 0) {
            this.buildItems(giftCertificates, this.context);
        }

        if (giftCertificatePIs.length > 0) {
            this.buildItemsGiftCertificatePIs(giftCertificatePIs, this.context);
        }

        this.buildShipments(shipments, this.context);

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.getOrderAmount = function (order) {
        var orderAmount = 0;

        if (order.totalGrossPrice.available) {
            orderAmount = order.totalGrossPrice.value * 100;
        } else {
            orderAmount = order.totalNetPrice.value * 100;
        }

        return orderAmount;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildTotalAmount = function (order) {
        var orderAmount = this.getOrderAmount(order);
        var gcTotalAmount = this.getGCtotalAmount(order);

        this.context.order_amount = Math.round(orderAmount - gcTotalAmount);

		// Set order discount line items
        this.addPriceAdjustments(order.priceAdjustments, null, null, this.context);

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.isTaxationPolicyNet = function () {
        return (this.getLocaleObject().country === 'US');
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildTotalTax = function (order) {
        var totalTax = order.totalTax.value * 100;
        var salesTaxItem = {};

        this.context.order_tax_amount = Math.round(totalTax);

        if (this.isTaxationPolicyNet()) {
            salesTaxItem = this.getSalesTaxRequestBuilder().build(order);

            this.context.order_lines.push(salesTaxItem);
        }

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildAdditionalCustomerInfo = function (order) {
        if (Site.getCurrent().getCustomPreferenceValue('kpAttachments') && HookMgr.hasHook('extra.merchant.data')) {
            this.context.attachment = {};
            this.context.attachment.content_type = CONTENT_TYPE;
            this.context.attachment.body = 	HookMgr.callHook('extra.merchant.data', 'BuildEMD', {
                LineItemCtnr: order
            });
        }

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildOptions = function () {
        this.context.options.color_details 					= Site.getCurrent().getCustomPreferenceValue('kpColorDetails');
        this.context.options.color_button 					= Site.getCurrent().getCustomPreferenceValue('kpColorButton');
        this.context.options.color_button_text 				= Site.getCurrent().getCustomPreferenceValue('kpColorButtonText');
        this.context.options.color_checkbox 				= Site.getCurrent().getCustomPreferenceValue('kpColorCheckbox');
        this.context.options.color_checkbox_checkmark 		= Site.getCurrent().getCustomPreferenceValue('kpColorCheckboxCheckmark');
        this.context.options.color_header 					= Site.getCurrent().getCustomPreferenceValue('kpColorHeader');
        this.context.options.color_link 					= Site.getCurrent().getCustomPreferenceValue('kpColorLink');
        this.context.options.color_border 					= Site.getCurrent().getCustomPreferenceValue('kpColorBorder');
        this.context.options.color_border_selected 			= Site.getCurrent().getCustomPreferenceValue('kpColorBorderSelected');
        this.context.options.color_text 					= Site.getCurrent().getCustomPreferenceValue('kpColorText');
        this.context.options.color_text_secondary 			= Site.getCurrent().getCustomPreferenceValue('kpColorTextSecondary');
        this.context.options.radius_border 					= Site.getCurrent().getCustomPreferenceValue('kpRadiusBorder');

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildMerchantInformation = function ()	{
        var country = this.getLocaleObject().country;

        this.context.merchant_urls.confirmation = URLUtils.https('KLARNA_PAYMENTS-Confirmation', 'klarna_country', country).toString();
        this.context.merchant_urls.notification = URLUtils.https('KLARNA_PAYMENTS-Notification', 'klarna_country', country).toString();

        return this;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildItem = function (li) {
        var item = this.orderLineItemRequestBuilder.build(li);

        return item;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildItems = function (items, context) {
        var i = 0;
        var li = {};
        var item = {};

        while (i < items.length) {
            li = items[i];

			// Add product-specific shipping line adjustments
            if (!empty(li.shippingLineItem)) {
                this.addPriceAdjustments(li.shippingLineItem.priceAdjustments.toArray(), li.productID, null, context);
            }

            if (!empty(li.priceAdjustments) && li.priceAdjustments.length > 0) {
                this.addPriceAdjustments(li.priceAdjustments.toArray(), li.productID, li.optionID, context);
            }

            item = this.buildItem(li);

            context.order_lines.push(item);

            i += 1;
        }
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildItemsGiftCertificatePIs = function (items, country, context)	{
        var li = [];
        var newItem = {};
        var i = 0;

        for (i = 0; i < items.length; i++) {
            li = items[i];

            newItem = this.getGiftCertificatePIRequestBuilder().build(li);

            context.order_lines.push(newItem);
        }
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.getGCtotalAmount = function (order) {
        var giftCertificatePIs = order.getGiftCertificatePaymentInstruments().toArray();
        var gcTotalAmount = 0;
        var i = 0;

        if (giftCertificatePIs.length > 0) {
            for (i = 0; i < giftCertificatePIs.length; i++) {
                gcTotalAmount += giftCertificatePIs[i].getPaymentTransaction().getAmount() * 100;
            }
        }
        return gcTotalAmount;
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.buildShipments = function (shipments, context) {
        var shipment = {};
        var shippingLineItem = {};

        for (var i = 0; i < shipments.length; i++) {
            shipment = shipments[i];

            if (!empty(shipment.shippingMethod)) {
                shippingLineItem = this.getShipmentItemRequestBuilder().build(shipment);

                this.addPriceAdjustments(shipment.shippingPriceAdjustments.toArray(), null, null, context);

                context.order_lines.push(shippingLineItem);
            }
        }
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.addPriceAdjustments = function (adjusments, pid, oid, context) {
        var adj = {};
        var adjustment = {};
        var priceAdjustmentRequestBuilder = this.getPriceAdjustmentRequestBuilder();

        for (var i = 0; i < adjusments.length; i++) {
            adj = adjusments[i];

            adjustment = priceAdjustmentRequestBuilder.build(adj);

            context.order_lines.push(adjustment);
        }
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.isValidLocaleObjectParams = function (localeObject) {
        return (!empty(localeObject.custom.country) || !empty(localeObject.custom.klarnaLocale));
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.isValidParams = function (params) {
        return (!empty(params.order) && !empty(params.localeObject) && this.isValidLocaleObjectParams(params.localeObject));
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.validateParams = function (params) {
        if (empty(params) || !this.isValidParams(params)) {
            throw new Error('Error when generating KlarnaPaymentsOrderRequestBuilder. Not valid params.');
        }
    };

    KlarnaPaymentsOrderRequestBuilder.prototype.build = function () {
        var order = this.params.order;

        this.init()
			.setMerchantReference(order)
			.buildLocale(order)
			.buildBilling(order)
			.buildShipping(order)
			.buildOrderLines(order)
			.buildTotalAmount(order)
			.buildTotalTax(order)
			.buildAdditionalCustomerInfo(order)
			.buildOptions()
			.buildMerchantInformation(order);

        return this.context;
    };

    module.exports = KlarnaPaymentsOrderRequestBuilder;
}());
