import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import User from '../models/userModel.js';
import asyncHandler from 'express-async-handler';
import { createPaymentIntent, processRefund } from '../config/stripe.js';
import { 
  sendOrderConfirmationEmail, 
  sendOrderStatusUpdateEmail,
  sendRefundConfirmationEmail 
} from '../utils/sendEmail.js';

// @desc    Create new order
// @route   POST /api/orders
const addOrderItems = asyncHandler(async (req, res) => {
  const {
    orderItems,
    shippingAddress,
    paymentMethod,
    itemsPrice,
    taxPrice,
    shippingPrice,
    totalPrice
  } = req.body;

  // Validate order items
  if (!orderItems || orderItems.length === 0) {
    res.status(400);
    throw new Error('No order items');
  }

  // Validate product availability and stock
  for (const item of orderItems) {
    const product = await Product.findById(item.product);
    
    if (!product) {
      res.status(404);
      throw new Error(`Product not found: ${item.product}`);
    }

    if (product.countInStock < item.quantity) {
      res.status(400);
      throw new Error(`Insufficient stock for product: ${product.name}`);
    }
  }

  // Create order
  const order = new Order({
    orderItems: orderItems.map(item => ({
      name: item.name,
      quantity: item.quantity,
      image: item.image,
      price: item.price,
      product: item.product
    })),
    user: req.user._id,
    shippingAddress,
    paymentMethod,
    itemsPrice,
    taxPrice,
    shippingPrice,
    totalPrice
  });

  // Update product stock
  for (const item of orderItems) {
    const product = await Product.findById(item.product);
    product.countInStock -= item.quantity;
    await product.save();
  }

  // Create payment intent
  const paymentIntent = await createPaymentIntent(totalPrice);
  order.paymentResult = {
    id: paymentIntent.id,
    status: 'pending'
  };

  const createdOrder = await order.save();

  // Send confirmation email
  await sendOrderConfirmationEmail(createdOrder, req.user);

  res.status(201).json({
    order: createdOrder,
    clientSecret: paymentIntent.client_secret
  });
});

// @desc    Get order by ID
// @route   GET /api/orders/:id
const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'firstName lastName email');

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  // Ensure only the order owner or admin can access the order
  if (order.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Not authorized to view this order');
  }

  res.json(order);
});

// @desc    Update order to paid
// @route   PUT /api/orders/:id/pay
const updateOrderToPaid = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  order.isPaid = true;
  order.paidAt = Date.now();
  order.paymentResult = {
    id: req.body.id,
    status: req.body.status,
    update_time: req.body.update_time,
    email_address: req.body.payer.email_address
  };

  const updatedOrder = await order.save();

  // Send payment confirmation email
  await sendOrderStatusUpdateEmail(updatedOrder, req.user);

  res.json(updatedOrder);
});

// @desc    Update order to delivered
// @route   PUT /api/orders/:id/deliver
const updateOrderToDelivered = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  order.isDelivered = true;
  order.deliveredAt = Date.now();
  order.orderStatus = 'Delivered';

  const updatedOrder = await order.save();

  // Send delivery confirmation email
  await sendOrderStatusUpdateEmail(updatedOrder, req.user);

  res.json(updatedOrder);
});

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id })
    .sort({ createdAt: -1 });
  res.json(orders);
});

// @desc    Get all orders (admin)
// @route   GET /api/orders
const getOrders = asyncHandler(async (req, res) => {
  const pageSize = 10;
  const page = Number(req.query.pageNumber) || 1;

  const count = await Order.countDocuments({});
  const orders = await Order.find({})
    .populate('user', 'firstName lastName')
    .limit(pageSize)
    .skip(pageSize * (page - 1))
    .sort({ createdAt: -1 });

  res.json({ 
    orders, 
    page, 
    pages: Math.ceil(count / pageSize) 
  });
});

// @desc    Process a refund for an order
// @route   POST /api/orders/:id/refund
const processOrderRefund = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  // Check if order is eligible for refund
  if (!order.isPaid || order.isRefunded) {
    res.status(400);
    throw new Error('Order cannot be refunded');
  }

  try {
    // Process refund through Stripe
    const refundResult = await processRefund(
      order.paymentResult.id, 
      order.totalPrice
    );

    // Update order status
    order.isRefunded = true;
    order.refundedAt = Date.now();
    order.orderStatus = 'Refunded';
    order.refundResult = {
      id: refundResult.id,
      status: refundResult.status
    };

    // Restore product stock
    for (const item of order.orderItems) {
      const product = await Product.findById(item.product);
      if (product) {
        product.countInStock += item.quantity;
        await product.save();
      }
    }

    const updatedOrder = await order.save();

    // Send refund confirmation email
    await sendRefundConfirmationEmail(updatedOrder, order.user);

    res.json(updatedOrder);
  } catch (error) {
    res.status(500);
    throw new Error(`Refund processing failed: ${error.message}`);
  }
});

// @desc    Cancel an order
// @route   PUT /api/orders/:id/cancel
const cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  // Check if order is cancelable
  if (order.orderStatus === 'Shipped' || order.orderStatus === 'Delivered') {
    res.status(400);
    throw new Error('Order cannot be canceled');
  }

  // Restore product stock
  for (const item of order.orderItems) {
    const product = await Product.findById(item.product);
    if (product) {
      product.countInStock += item.quantity;
      await product.save();
    }
  }

  // Update order status
  order.orderStatus = 'Canceled';
  order.canceledAt = Date.now();

  const canceledOrder = await order.save();

  // Send cancellation email
  await sendOrderStatusUpdateEmail(canceledOrder, req.user);

  res.json(canceledOrder);
});

export {
  addOrderItems,
  getOrderById,
  updateOrderToPaid,
  updateOrderToDelivered,
  getMyOrders,
  getOrders,
  processOrderRefund,
  cancelOrder
};