import Stripe from 'stripe';
import { Payment, PaymentType } from '~/models/payment';
import { PaymentStatus } from '~/enum/paymentStatus';
import { User } from '~/models/userModel';
import { ApiError } from '~/middleware/apiError';
import { ErrorMessage } from '~/enum/errorMessage';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

class StripeService {
  private successUrl = process.env.STRIPE_SUCCESS_URL;
  private cancelUrl = process.env.STRIPE_CANCEL_URL;
  private currency = (process.env.STRIPE_CURRENCY || 'vnd').toLowerCase();

  public createCheckoutSession = async (payment: PaymentType) => {
    const amount = Math.round(payment.amount || 0);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: this.currency,
            product_data: {
              name: `Mua ${payment.tokens} token`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      // metadata giúp correlate session với payment trong webhook
      metadata: {
        paymentId: payment._id.toString(),
        userId: payment.user?.toString?.() || '',
      },
      success_url: `${this.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: this.cancelUrl,
    });

    return session;
  };

  /* Handler khi stripe tra ve */
  public handleEvent = async (event: Stripe.Event) => {
    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const paymentId = session.metadata?.paymentId;
        if (!paymentId) return { handled: true };

        const payment = await Payment.findById(paymentId);
        if (!payment) return { handled: false, message: 'Payment not found' };

        // Nếu đã confirm rồi thì bỏ qua
        if (payment.status === PaymentStatus.SUCCEEDED)
          return { handled: true };

        // mark succeeded
        payment.status = PaymentStatus.SUCCEEDED;
        await payment.save();

        // cộng token cho user
        if (payment.user && payment.tokens && payment.tokens > 0) {
          await User.findByIdAndUpdate(payment.user, {
            $inc: { tokens: payment.tokens },
          });
        }

        return { handled: true };
      }
      return { handled: false };
    } catch (err) {
      console.error('Stripe webhook handling error:', err);
      return { handled: false, error: err };
    }
  };
}

export default new StripeService();
