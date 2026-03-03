import './TermsDialog.css';

function CloseIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3.5 3.5L12.5 12.5" />
            <path d="M12.5 3.5L3.5 12.5" />
        </svg>
    );
}

function TermsDialog({ isOpen, onClose }) {
    if (!isOpen) return null;

    return (
        <div className="terms-overlay" onClick={onClose}>
            <div className="terms-dialog" onClick={(e) => e.stopPropagation()}>
                <button className="terms-close" onClick={onClose} aria-label="Close terms">
                    <CloseIcon />
                </button>
                <div className="terms-content">
                    <h2 className="terms-heading">TERMS AND CONDITIONS</h2>
                    <p className="terms-text">
                        Please observe the below terms and conditions, you are reminded that when purchasing or visiting this website you automatically agree to the following terms and conditions. Any alternative terms and conditions on the part of the customer shall not apply unless we should confirm these in writing. There are no supplementary agreement.
                    </p>

                    <h2 className="terms-heading">PRIVACY POLICY</h2>
                    <p className="terms-text">
                        DEJAVU Inc. operates the https://www.vujade-studio.com/website. This page is to inform website visitors regarding our policies with the collection, use, and disclosure of personal information should they decide to use our services on our website.
                    </p>
                    <p className="terms-text">
                        If you do choose to use our service on our website, you agree to the collection and use of information in relation to this policy. The personal information that we collect is used for providing and improving the service and will not share your information with anyone except as described in this privacy policy.
                    </p>
                    <p className="terms-text">
                        Personal information includes such as the following:
                    </p>
                    <p className="terms-text">
                        Biographical Data: Name, surname, date of birth.
                    </p>
                    <p className="terms-text">
                        Contact Data: Address of residence, email address.
                    </p>
                    <p className="terms-text">
                        Sales Data: Shipping and billing address, method of delivery and payment, name of credit card holder and expiration date, information requested by the customer service.
                    </p>
                    <p className="terms-text">
                        Purchase Data: Detail of the purchased products such as size, price, model, collection, abandoned cart, etc.
                    </p>
                    <p className="terms-text">
                        Navigation Data: Data related to browsing behavior such as cookies, or information relating to the pages visited, etc.
                    </p>

                    <h2 className="terms-heading">PAYMENT</h2>
                    <p className="terms-text">
                        Deja Vu accepts the following payment methods:
                    </p>
                    <p className="terms-text">
                        Visa, Mastercard, JCB, American Express, Apple Pay, Google Pay.
                    </p>
                    <p className="terms-text">
                        Upon purchase of your goods, there will be a 2 step process of authorization and acquisition. The first step involves the verification of customers payment details, after which the order amount is reserved and undergoes the second step of acquisition.
                    </p>
                    <p className="terms-text">
                        In the second step, the reserved amount is transferred from the customer's account to the DEJAVU Inc. account and the payment will appear on your statement as DEJAVU Inc..
                    </p>
                    <p className="terms-text">
                        By creating an account on our website, we offer a fast purchase service, which allows you to save your credit card details, shipping/billing address for future purchases.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default TermsDialog;
