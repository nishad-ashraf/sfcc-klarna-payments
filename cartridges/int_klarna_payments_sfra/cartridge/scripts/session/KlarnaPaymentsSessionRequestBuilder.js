( function()
{
	'use strict';

	var ShippingMgr = require( 'dw/order/ShippingMgr' );
	var Transaction = require( 'dw/system/Transaction' );
	var URLUtils = require( 'dw/web/URLUtils' );
	var Site = require( 'dw/system/Site' );
	var Logger = require( 'dw/system/Logger' );
	var TaxMgr = require( 'dw/order/TaxMgr' );
	var HookMgr = require( 'dw/system/HookMgr' );
	var ArrayList = require( 'dw/util/ArrayList' );

	var Builder = require( '../util/Builder' );
	var KlarnaUtils = require( '../util/KlarnaUtils' );
	var ORDER_LINE_TYPE = require( '../util/KlarnaPaymentsConstants.js' ).ORDER_LINE_TYPE;
	var CONTENT_TYPE = require( '../util/KlarnaPaymentsConstants.js' ).CONTENT_TYPE;
	var KlarnaPaymentsSessionModel = require( './KlarnaPaymentsSessionModel' ).KlarnaPaymentsSessionModel;
	var LineItem = require( './KlarnaPaymentsSessionModel' ).LineItem;
	var log = Logger.getLogger( 'KlarnaPaymentsSessionRequestBuilder.js' );

	function KlarnaPaymentsSessionRequestBuilder() {
		this.context = null;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype = new Builder();
	KlarnaPaymentsSessionRequestBuilder.prototype.get = function()
	{
		return this.context;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype._buildRequest = function( params ) {
		var basket = params.basket;
		var preAssement = KlarnaUtils.isEnabledPreassessmentForCountry( this.getLocaleObject().country );
		var requestBodyObject = {};

		requestBodyObject = this.init( preAssement );

		this.setMerchantReference( basket );
	
		this.buildLocale( basket );

		if ( preAssement ) {
			this.buildBilling( basket )
			this.buildShipping( basket )
		}

		this.buildOrderLines( basket )
		this.buildTotalAmount( basket )
		this.buildTotalTax( basket )
		this.buildAdditionalCustomerInfo( basket )
		this.buildOptions();

		return requestBodyObject;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.setLocaleObject = function( localeObject ) {
		this.localeObject = localeObject;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getLocaleObject = function() {
		return this.localeObject;
	}

	/*
	    Build request here
	*/
	KlarnaPaymentsSessionRequestBuilder.prototype.buildRequest = function( params ) {
		this.validateParams( params );

		this.setLocaleObject( params.localeObject.custom );

		return this._buildRequest( params );
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.init = function( preAssement )
	{
		this.context = new KlarnaPaymentsSessionModel( preAssement );

		return this;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.setMerchantReference = function( basket )
	{
		this.context.merchant_reference2 = "";

		if ( Site.getCurrent().getCustomPreferenceValue( 'merchant_reference2_mapping' ) ) {
			try {
				this.context.merchant_reference2 = basket[Site.getCurrent().getCustomPreferenceValue( 'merchant_reference2_mapping' )].toString();
			} catch( err ) {
				log.error( "merchant_reference2 was not set. Error: {0} ", err.message );
			}
		}

		return this;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.buildAddressFromShippingAddress = function( address, basket, shippingAddress ) {
		address.given_name = shippingAddress.getFirstName();
		address.family_name = shippingAddress.getLastName();
		address.email = strval( basket.getCustomerEmail() );
		address.title = strval( shippingAddress.getTitle() );
		address.street_address = shippingAddress.getAddress1();
		address.street_address2 = strval( shippingAddress.getAddress2() );
		address.postal_code = shippingAddress.getPostalCode();
		address.city = shippingAddress.getCity();
		address.region = shippingAddress.getStateCode();
		address.phone = shippingAddress.getPhone();
		address.country = shippingAddress.getCountryCode().toString();

		return this;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.buildBilling = function( basket ) {
		var currentCustomer = {};
		var customerPreferredAddress = {};

		currentCustomer = basket.getCustomer();
		customerPreferredAddress = {};

		this.context.billing_address.email = basket.customerEmail || '';

		if ( empty( currentCustomer ) || empty( currentCustomer.profile ) ) {
			let shippingAddress = basket.getShipments().iterator().next().getShippingAddress();

			if ( shippingAddress ) {
				this.buildAddressFromShippingAddress( this.context.billing_address, basket, shippingAddress );
			}
		} else {
			this.context.billing_address.email = currentCustomer.profile.email;
			this.context.billing_address.phone = currentCustomer.profile.phoneMobile;
			this.context.billing_address.given_name = currentCustomer.profile.firstName;
			this.context.billing_address.family_name = currentCustomer.profile.lastName;

			this.buildAddressFromCustomerPreferredAddress( this.context.billing_address, currentCustomer );
		}

		return this;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.buildAddressFromCustomerPreferredAddress = function( address, currentCustomer ) {
		var customerPreferredAddress = currentCustomer.addressBook.preferredAddress;

		if ( !empty( customerPreferredAddress ) ) {
			buildAddressFromCustomerAddress.bind( this )( address, customerPreferredAddress );
		}
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.buildShipping = function( basket ) {
		var currentCustomer = {};
		var customerPreferredAddress = {};

		currentCustomer = basket.getCustomer();
		customerPreferredAddress = {};

		this.context.shipping_address.email = basket.customerEmail || '';

		if ( empty( currentCustomer ) || empty( currentCustomer.profile ) ) {
			let shippingAddress = basket.getShipments().iterator().next().getShippingAddress();

			// get default shipment shipping address
			if ( empty( shippingAddress ) ) {
				delete this.context.shipping_address;
			} else {
				this.buildAddressFromShippingAddress( this.context.shipping_address, basket, shippingAddress );
			}
		} else {
			this.context.shipping_address.email = "";
			this.context.shipping_address.phone = currentCustomer.profile.phoneMobile;
			this.context.shipping_address.given_name = currentCustomer.profile.firstName;
			this.context.shipping_address.family_name = currentCustomer.profile.lastName;

			this.buildAddressFromCustomerPreferredAddress( this.context.shipping_address, currentCustomer );
		}

		return this;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.buildLocale = function( basket ) {
		var localeObject = this.getLocaleObject();
		var currency = basket.getCurrencyCode();

		this.context.purchase_country = localeObject.country;
		this.context.purchase_currency = currency;
		this.context.locale = localeObject.klarnaLocale;

		return this;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.buildOrderLines = function( basket ) {
		var _self = this;

		var lineItems = basket.getAllProductLineItems().toArray();
		var giftCertificates = basket.getGiftCertificateLineItems().toArray();
		var giftCertificatePIs = basket.getGiftCertificatePaymentInstruments().toArray();
		var shipments = basket.shipments;

		this.buildItems( lineItems, this.context );

		if ( giftCertificates.length > 0 ) {
			this.buildItems( giftCertificates, this.context );
		}

		if ( giftCertificatePIs.length > 0 ) {
			this.buildItemsGiftCertificatePIs( giftCertificatePIs, this.context );
		}

		this.buildShipments( shipments, this.context );

		return this;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.getOrderAmount = function( basket ) {
		var gcTotalAmount = this.getGCtotalAmount( basket );

		return ( basket.totalGrossPrice.available ? basket.totalGrossPrice.value : basket.totalNetPrice.value ) * 100 - gcTotalAmount;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.buildTotalAmount = function( basket ) {
		var orderAmount = this.getOrderAmount( basket );

		this.context.order_amount = Math.round( orderAmount );

		// Set order discount line items
		this.addPriceAdjustments( basket.priceAdjustments, null, null, this.context );

		return this;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.buildTotalTax = function( basket ) {
		var totalTax = basket.totalTax.value * 100;
		var usTotalTax = 0;
		var salesTaxItem = {};

		this.context.order_tax_amount = Math.round( totalTax );

		if ( this.isTaxationPolicyNet() ) {
			usTotalTax = Math.round( ( basket.totalTax.available ) ? basket.totalTax.value * 100 : 0 );
			salesTaxItem = new LineItem();
			salesTaxItem.quantity = 1;
			salesTaxItem.type = ORDER_LINE_TYPE.SALES_TAX;
			salesTaxItem.name = 'Sales Tax';
			salesTaxItem.reference = 'Sales Tax';
			salesTaxItem.unit_price = usTotalTax;
			salesTaxItem.tax_rate = 0;
			salesTaxItem.total_amount = usTotalTax;
			salesTaxItem.total_tax_amount = 0;

			this.context.order_lines.push( salesTaxItem );
		}

		return this;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.buildAdditionalCustomerInfo = function( basket ) {
		if ( Site.getCurrent().getCustomPreferenceValue( 'kpAttachments' ) ) {
			this.context.attachment = new Object();
			this.context.attachment.content_type = CONTENT_TYPE;
			this.context.attachment.body = this._buildAdditionalCustomerInfoBody( basket );
		}

		return this;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.buildAdditionalCustomerPurchaseHistory = function( customer ) {
		var purchase_history_full = new Array( new Object() );
		purchase_history_full[0].unique_account_identifier = customer.ID;
		purchase_history_full[0].payment_option = "other";

		if ( customer.getActiveData() ) {
			purchase_history_full[0].number_paid_purchases = !empty( customer.activeData.orders ) ? customer.activeData.orders : 0;
			purchase_history_full[0].total_amount_paid_purchases = !empty( customer.activeData.orderValue ) ? customer.activeData.orderValue : 0;
			purchase_history_full[0].date_of_last_paid_purchase = !empty( customer.activeData.lastOrderDate ) ? customer.activeData.lastOrderDate.toISOString().slice( 0, -5 ) + 'Z' : '';
			purchase_history_full[0].date_of_first_paid_purchase = "";
		}

		return purchase_history_full;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype._buildAdditionalCustomerInfoBody = function( basket ) {
		var customer = basket.getCustomer();
		var body = new Object();

		body.customer_account_info = new Array( new Object() );

		if ( customer.registered ) {
			body.customer_account_info[0].unique_account_identifier = customer.profile.customerNo;
			body.customer_account_info[0].account_registration_date = !empty( customer.profile.creationDate ) ? customer.profile.creationDate.toISOString().slice( 0, -5 ) + 'Z' : '';
			body.customer_account_info[0].account_last_modified = !empty( customer.profile.lastModified ) ? customer.profile.lastModified.toISOString().slice( 0, -5 ) + 'Z' : '';
		}

		body.purchase_history_full = this.buildAdditionalCustomerPurchaseHistory( customer );

		return JSON.stringify( body );
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.buildOptions = function()
	{
		this.context.options.color_details 				= Site.getCurrent().getCustomPreferenceValue( 'kpColorDetails' );
		this.context.options.color_button 				= Site.getCurrent().getCustomPreferenceValue( 'kpColorButton' );
		this.context.options.color_button_text 			= Site.getCurrent().getCustomPreferenceValue( 'kpColorButtonText' );
		this.context.options.color_checkbox 			= Site.getCurrent().getCustomPreferenceValue( 'kpColorCheckbox' );
		this.context.options.color_checkbox_checkmark 	= Site.getCurrent().getCustomPreferenceValue( 'kpColorCheckboxCheckmark' );
		this.context.options.color_header 				= Site.getCurrent().getCustomPreferenceValue( 'kpColorHeader' );
		this.context.options.color_link 				= Site.getCurrent().getCustomPreferenceValue( 'kpColorLink' );
		this.context.options.color_border 				= Site.getCurrent().getCustomPreferenceValue( 'kpColorBorder' );
		this.context.options.color_border_selected 		= Site.getCurrent().getCustomPreferenceValue( 'kpColorBorderSelected' );
		this.context.options.color_text 				= Site.getCurrent().getCustomPreferenceValue( 'kpColorText' );
		this.context.options.color_text_secondary 		= Site.getCurrent().getCustomPreferenceValue( 'kpColorTextSecondary' );
		this.context.options.radius_border 				= Site.getCurrent().getCustomPreferenceValue( 'kpRadiusBorder' );

		return this;
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.getItemPrice = function( li ) {
		return ( li.grossPrice.available && !this.isTaxationPolicyNet() ? li.grossPrice.value : li.netPrice.value ) * 100;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getItemTaxRate = function( li ) {
		return ( this.isTaxationPolicyNet() ) ? 0 : Math.round( li.taxRate * 10000 );
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getItemTaxAmount = function( li ) {
		return ( this.isTaxationPolicyNet() ) ? 0 : Math.round( li.tax.value * 100 );
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getItemType = function( li ) {
		var type = '';

		if ( li.hasOwnProperty( 'optionProductLineItem' ) && li.optionProductLineItem ) {
			type = ORDER_LINE_TYPE.SURCHARGE;
		} else {
			type = ORDER_LINE_TYPE.PHYSICAL;
		}

		return type;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getItemId = function( li ) {
		var id = '';

		if ( li.hasOwnProperty( 'optionProductLineItem' ) && li.optionProductLineItem ) {
			id = li.parent.productID + '_' + li.optionID + '_' + li.optionValueID;
		} else {
			id = li.productID;
		}

		return id;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getItemBrand = function( li ) {
		var brand = '';

		if ( li.hasOwnProperty( 'optionProductLineItem' ) && li.optionProductLineItem ) {
			brand = ( !empty( li.parent.product ) ? li.parent.product.brand : null );
		} else {
			brand = ( !empty( li.product ) ? li.product.brand : null );
		}

		return brand;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getItemCategoryPath = function( li ) {
		var path = '';

		if ( li.hasOwnProperty( 'optionProductLineItem' ) && li.optionProductLineItem ) {
			path = ( !empty( li.parent.product ) ? this._getProductCategoryPath( li.parent.product ) : null );
		} else {
			path = ( !empty( li.product ) ? this._getProductCategoryPath( li.product ) : null );
		}

		return path;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.generateItemProductURL = function( li ) {
		var url = '';

		if ( li.optionProductLineItem ) {
			url = ( URLUtils.http( 'Product-Show', 'pid', li.parent.productID ).toString() );
		} else {
			url = ( URLUtils.http( 'Product-Show', 'pid', li.productID ).toString() );
		}

		return url;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.generateItemImageURL = function( li ) {
		var url = '';

		if ( li.optionProductLineItem ) {
			url = ( li.parent.getProduct().getImage( 'small', 0 ).getImageURL( {} ).toString() );
		} else {
			url = ( li.getProduct().getImage( 'small', 0 ).getImageURL( {} ).toString() );
		}

		return url;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.buildItemProductAndImageUrls = function( li, item ) {
		if ( Site.getCurrent().getCustomPreferenceValue( 'sendProductAndImageURLs' ) ) {
			item.product_url = this.generateItemProductURL( li );
			item.image_url = this.generateItemImageURL( li );
		}
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.buildItem = function( li ) {
		var itemPrice = this.getItemPrice( li );
		var	itemType = '';
		var item = {};
		var quantity = li.quantityValue;
		var brand = this.getItemBrand( li );
		var categoryPath = this.getItemCategoryPath( li );

		item = new LineItem();
		item.type = this.getItemType( li );
		item.reference = this.getItemId( li );
		item.quantity = quantity;
		item.type = itemType;
		item.name = li.productName.replace( /[^\x00-\x7F]/g, "" );
		item.unit_price = Math.round( itemPrice / quantity );
		item.tax_rate = this.getItemTaxRate( li );
		item.total_amount = Math.round( itemPrice );
		item.total_tax_amount = this.getItemTaxAmount( li );

		if ( !empty( brand ) ) {
			item.product_identifiers = item.product_identifiers || {};
			item.product_identifiers.brand = brand;
		}

		if ( !empty( categoryPath ) ) {
			item.product_identifiers = item.product_identifiers || {};
			item.product_identifiers.category_path = categoryPath;
		}

		this.buildItemProductAndImageUrls( li, item );

		return item;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.buildItems = function( items, context ) {
		var i = 0;
		var li = {};

		while ( i < items.length ) {
			li = items[i];

			// Add product-specific shipping line adjustments
			if ( !empty( li.shippingLineItem ) ) {
				this.addPriceAdjustments( li.shippingLineItem.priceAdjustments.toArray(), li.productID, null, context );
			}

			if ( !empty( li.priceAdjustments ) && li.priceAdjustments.length > 0 ) {
				this.addPriceAdjustments( li.priceAdjustments.toArray(), li.productID, li.optionID, context );
			}

			context.order_lines.push( this.buildItem( li ) );

			i += 1;
		}
	}

	KlarnaPaymentsSessionRequestBuilder.prototype._getProductCategoryPath = function( product ) {
		var path = '';
		// get category from products primary category
		var category = product.primaryCategory;

		// get category from product master if not set at variant
		if( category === null && product.variant ) {
			category = product.variationModel.master.primaryCategory;
		}

		if ( category !== null ) {
			path = new ArrayList();
			while( category.parent !== null ) {
				if( category.online ) { 
					path.addAt( 0, category.displayName );
				}

				category = category.parent;
			}
			path = path.join( ' > ' ).substring( 0, 749 ); //Maximum 750 characters per Klarna's documentation
		}		
		
		return path;		
	}
	
	KlarnaPaymentsSessionRequestBuilder.prototype.buildItemsGiftCertificatePIs = function( items, context ) {
		var li = [];
		var item = {};
		var paymentTransaction = {};
		var i = 0;

		for ( i = 0; i < items.length; i++ ) {
			li = items[i];
			paymentTransaction = li.getPaymentTransaction();

			item = new LineItem();
			item.quantity = 1;
			item.type = ORDER_LINE_TYPE.GIFT_CERTIFICATE_PI;
			item.name = 'Gift Certificate';
			item.reference = li.getMaskedGiftCertificateCode();
			item.unit_price = paymentTransaction.getAmount() * 100 * ( -1 );
			item.tax_rate = 0;
			item.total_amount = paymentTransaction.getAmount() * 100 * ( -1 );
			item.total_tax_amount = 0;

			context.order_lines.push( item );
		}
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getGCtotalAmount = function( basket ) {
		var giftCertificatePIs = basket.getGiftCertificatePaymentInstruments().toArray();
		var gcTotalAmount = 0;
		var i = 0;

		if ( giftCertificatePIs.length > 0 ) {
			for ( i = 0; i < giftCertificatePIs.length; i++ ) {
				gcTotalAmount += giftCertificatePIs[i].getPaymentTransaction().getAmount() * 100;
			}
		}
 
		return gcTotalAmount;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.calculateShippingTotalTaxAmount = function( shipment ) {
		return ( this.isTaxationPolicyNet() ) ? 0 : Math.round( shipment.shippingTotalTax.value * 100 );
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.buildShipmentItem = function( shipment ) {
		var shipment_tax_rate = this.getShipmentTaxRate( shipment );
		var shipment_unit_price = this.getShipmentUnitPrice( shipment );

		shippingLineItem = new LineItem();
		shippingLineItem.quantity = 1;
		shippingLineItem.type = ORDER_LINE_TYPE.SHIPPING_FEE;
		shippingLineItem.name = shipment.shippingMethod.displayName.replace( /[^\x00-\x7F]/g, "" );
		shippingLineItem.reference = shipment.shippingMethod.ID;
		shippingLineItem.unit_price = Math.round( shipment_unit_price );
		shippingLineItem.tax_rate = Math.round( shipment_tax_rate );
		shippingLineItem.total_amount = shippingLineItem.unit_price;
		shippingLineItem.total_tax_amount = this.calculateShippingTotalTaxAmount( shipment );

		return shippingLineItem;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.isTaxationPolicyNet = function() {
		return ( this.getLocaleObject().country === 'US' );
	};

	KlarnaPaymentsSessionRequestBuilder.prototype.getShipmentTaxRate = function( shipment ) {
		var shipment_tax_rate = 0;

		if ( !empty( shipment.shippingMethod ) && !empty( shipment.shippingMethod.taxClassID ) && !empty( shipment.shippingAddress ) ) {
			shipment_tax_rate = ( this.isTaxationPolicyNet() ) ? 0 : ( TaxMgr.getTaxRate( shipment.shippingMethod.taxClassID, TaxMgr.getTaxJurisdictionID( new dw.order.ShippingLocation( shipment.shippingAddress ) ) ) ) * 10000;
		}

		return shipment_tax_rate;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getShipmentUnitPrice = function( shipment ) {
		var shipment_unit_price = ( shipment.shippingTotalGrossPrice.available && !this.isTaxationPolicyNet() ? shipment.shippingTotalGrossPrice.value : shipment.shippingTotalNetPrice.value ) * 100;

		return shipment_unit_price;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.buildShipments = function( shipments, context ) {
		var shipment = {};
		var shippingLineItem = {};

		for ( let i = 0; i < shipments.length; i++ ) {
			shipment = shipments[i];

			if ( !empty( shipment.shippingMethod ) ) {
				shippingLineItem = this.buildShipmentItem( shipment );

				this.addPriceAdjustments( shipment.shippingPriceAdjustments.toArray(), null, null, context );

				context.order_lines.push( shippingLineItem );
			}
		}
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getPriceAdjustmentPromoName = function( adj ) {
		var promoName = !empty( adj.promotion ) && !empty( adj.promotion.name ) ? adj.promotion.name : ORDER_LINE_TYPE.DISCOUNT;

		promoName = promoName.replace( /[^\x00-\x7F]/g, "" );

		return promoName;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getPriceAdjustmentPromoId = function( adj, pid, oid ) {
		var promoId = adj.promotionID;

		if ( !empty( pid ) ) {
			promoId = pid + '_' + promoId;
		} else if ( !empty( oid ) ) {
			promoId = oid + '_' + promoId;
		}

		return promoId;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getPriceAdjustmentMerchantData = function( adj ) {
		return ( adj.couponLineItem ? adj.couponLineItem.couponCode : '' );
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getPriceAdjustmentTaxRate = function( adj ) {
		return ( this.isTaxationPolicyNet() ) ? 0 : Math.round( adj.taxRate * 10000 );
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getPriceAdjustmentTotalTaxAmount = function( adj ) {
		return ( this.isTaxationPolicyNet() ) ? 0 : Math.round( adj.tax.value * 100 );
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.getPriceAdjustmentUnitPrice = function( adj ) {
		return ( adj.grossPrice.available && !this.isTaxationPolicyNet() ? adj.grossPrice.value : adj.netPrice.value ) * 100;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.addPriceAdjustments = function( adjusments, pid, oid, context ) {
		var adjusmentPrice = 0;
		var promoName = '';
		var promoId = '';
		var adj = {};
		var adjustment = {};

		for ( let i = 0; i < adjusments.length; i++ ) {
			adj = adjusments[i];
			adjustment = new LineItem();
			adjusmentPrice = this.getPriceAdjustmentUnitPrice( adj );

			adjustment.quantity = 1;
			adjustment.type = ORDER_LINE_TYPE.DISCOUNT;
			adjustment.name = this.getPriceAdjustmentPromoName( adj );
			adjustment.reference = this.getPriceAdjustmentPromoId( adj );
			adjustment.unit_price = Math.round( adjusmentPrice );
			adjustment.merchant_data = this.getPriceAdjustmentMerchantData( adj );
			adjustment.tax_rate = this.getPriceAdjustmentTaxRate( adj );
			adjustment.total_amount = adjustment.unit_price;
			adjustment.total_tax_amount = this.getPriceAdjustmentTotalTaxAmount( adj ) ;

			context.order_lines.push( adjustment );
		}
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.strval = function( obj ) {
		//  discuss at: http://locutus.io/php/strval/
		// original by: Brett Zamir (http://brett-zamir.me)
		// improved by: Kevin van Zonneveld (http://kvz.io)
		// bugfixed by: Brett Zamir (http://brett-zamir.me)
		//   example 1: strval({red: 1, green: 2, blue: 3, white: 4})
		//   returns 1: 'Object'

		if ( obj === null ) {
			return ''
		}

		return obj;
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.buildAddressFromCustomerAddress = function( address, customerAddress ) {
		address.phone = customerAddress.phone;
		address.given_name = customerAddress.firstName;
		address.family_name = customerAddress.lastName;
		address.street_address = strval( customerAddress.address1 );
		address.street_address2 = strval( customerAddress.address2 );
		address.postal_code = strval( customerAddress.postalCode );
		address.city = strval( customerAddress.city );
		address.region = strval( customerAddress.stateCode );
		address.country = strval( customerAddress.countryCode.value );
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.isLocaleObjectParamsValid = function( localeObject ) {
		return ( !empty( localeObject.custom.country ) || !empty( localeObject.custom.klarnaLocale ) );
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.isParamsValid = function( params ) {
		return ( !empty( params.basket ) && !empty( params.localeObject ) && this.isLocaleObjectParamsValid( params.localeObject ) );
	}

	KlarnaPaymentsSessionRequestBuilder.prototype.validateParams = function( params ) {
		if ( empty( params ) || !this.isParamsValid( params ) ) {
			throw new Error( 'Error when generating KlarnaPaymentsSessionRequestBuilder. Not valid params.' );
		}
	}

	module.exports = KlarnaPaymentsSessionRequestBuilder;
}() );