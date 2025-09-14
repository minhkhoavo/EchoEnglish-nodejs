import Stripe from "stripe";
import { Payment, PaymentType } from "~/models/payment";
import { PaymentStatus } from "~/enum/paymentStatus";
import { User } from "~/models/userModel";
import { ApiError } from "~/middleware/apiError";
import { ErrorMessage } from "~/enum/errorMessage";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

class StripeService {
  private successUrl = process.env.STRIPE_SUCCESS_URL || "https://example.com/success"; // override in env
  private cancelUrl = process.env.STRIPE_CANCEL_URL || "https://example.com/cancel";   // override in env
  private currency = (process.env.STRIPE_CURRENCY || "usd").toLowerCase(); // ensure lowercase

  public createCheckoutSession = async (payment: PaymentType) => {
    const amountInUSD  = Math.round(payment.amount || 0); 
    const amountInCents = Math.round(amountInUSD * 100);

    if (amountInCents < 50) {
      throw new ApiError(ErrorMessage.AMOUNT_LIMIT);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: this.currency,
            product_data: {
              name: `Mua ${payment.tokens} token`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      // metadata giúp correlate session với payment trong webhook
      metadata: {
        paymentId: payment._id.toString(),
        userId: payment.user?.toString?.() || "",
      },
      success_url: `${this.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: this.cancelUrl,
    });

    return session;
  };

  /**
   * Xử lý webhook (stripe signature verification được controller truyền vào)
   * - event: Stripe.Event
   * - trả về object để controller trả response
   */
  public handleEvent = async (event: Stripe.Event) => {
    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const paymentId = session.metadata?.paymentId;
        if (!paymentId) return { handled: true };

        const payment = await Payment.findById(paymentId);
        if (!payment) return { handled: false, message: "Payment not found" };

        // Nếu đã confirm rồi thì bỏ qua
        if (payment.status === PaymentStatus.SUCCEEDED) return { handled: true };

        // mark succeeded
        payment.status = PaymentStatus.SUCCEEDED;
        await payment.save();

        // cộng token cho user
        if (payment.user && payment.tokens && payment.tokens > 0) {
          await User.findByIdAndUpdate(payment.user, { $inc: { tokens: payment.tokens } });
        }

        return { handled: true };
      }

      // Bạn có thể handle event khác (payment_intent.succeeded, charge.refunded...) nếu cần
      return { handled: false };
    } catch (err) {
      console.error("Stripe webhook handling error:", err);
      return { handled: false, error: err };
    }
  };
}

export default new StripeService();