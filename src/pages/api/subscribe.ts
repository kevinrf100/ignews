import { query } from "faunadb";
import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "next-auth/react";
import { fauna } from "../../services/fauna";

import { stripe } from '../../services/stripe'

type User = {
    ref: {
        id: string;
    },
    data: {
        stripe_customer_id: string;
    }
}

export default async function handle(request: NextApiRequest, response: NextApiResponse) {
    if(request.method === "POST") {
        const session = await getSession({req: request});

        if(session?.user?.email) {
            const user = await fauna.query<User>(
                query.Get(
                    query.Match(
                        query.Index('user_by_email'),
                        query.Casefold(session.user.email)
                    )
                )
            )

            let customerId = user.data.stripe_customer_id
            if(!customerId) {
                const stripeCustomer = await stripe.customers.create({
                    email: session.user.email
                });

                await fauna.query(
                    query.Update(
                        query.Ref(query.Collection('users'), user.ref.id),
                        {
                            data: {
                                stripe_customer_id: stripeCustomer.id
                            }
                        }
                    )
                );
                customerId = stripeCustomer.id;
            }

            const stripeCheckoutSession = await stripe.checkout.sessions.create({
                customer: customerId,
                payment_method_types: ['card'],
                billing_address_collection: 'required',
                line_items: [
                    {price: 'price_1MC8vdFgKgTlyB7bOpKHXQ6Q', quantity: 1}
                ],
                mode: 'subscription',
                allow_promotion_codes: true,
                success_url: process.env.STRIPE_SUCCESS_URL!,
                cancel_url: process.env.STRIPE_CANCEL_URL!
            })
            return response.status(200).json({sessionId: stripeCheckoutSession.id});
        }

    } else {
        response.setHeader('allow', 'POST');
        response.status(405).end('Method Not Allowed');
    }
}