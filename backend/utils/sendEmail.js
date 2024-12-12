import nodemailer from 'nodemailer';

// Create a transporter using SMTP
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    secure: process.env.SMTP_SECURE === 'true'
  });
};

// Send order confirmation email
const sendOrderConfirmationEmail = async (order, user) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: `Order Confirmation - Order #${order._id}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Thank you for your order!</h2>
        <p>Order Number: <strong>${order._id}</strong></p>
        <p>Total Amount: <strong>$${order.totalPrice.toFixed(2)}</strong></p>
        <h3>Order Items:</h3>
        <ul>
          ${order.orderItems.map(item => `
            <li>
              ${item.name} - Quantity: ${item.quantity} - $${(item.price * item.quantity).toFixed(2)}
            </li>
          `).join('')}
        </ul>
        <p>Shipping Address:</p>
        <address>
          ${order.shippingAddress.street}<br>
          ${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}<br>
          ${order.shippingAddress.country}
        </address>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Order confirmation email sent to ${user.email}`);
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
  }
};

// Send password reset email
const sendPasswordResetEmail = async (user, resetToken) => {
  const transporter = createTransporter();

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: 'Password Reset Request',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Request</h2>
        <p>You have requested a password reset. Click the link below to reset your password:</p>
        <p><a href="${resetUrl}" style="color: #007bff;">Reset Password</a></p>
        <p>If you did not request a password reset, please ignore this email.</p>
        <p>This link will expire in 10 minutes.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent to ${user.email}`);
  } catch (error) {
    console.error('Error sending password reset email:', error);
  }
};

export { 
  sendOrderConfirmationEmail,
  sendPasswordResetEmail
};