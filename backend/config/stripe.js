import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16', // Use the latest API version
});

export const createPaymentIntent = async (amount, currency = 'usd') => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency,
    });

    return paymentIntent.client_secret;
  } catch (error) {
    console.error('Payment Intent Creation Error:', error);
    throw error;
  }
};

export const processRefund = async (paymentIntentId, amount) => {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: Math.round(amount * 100), // Convert to cents
    });

    return refund;
  } catch (error) {
    console.error('Refund Processing Error:', error);
    throw error;
  }
};

export default stripe;