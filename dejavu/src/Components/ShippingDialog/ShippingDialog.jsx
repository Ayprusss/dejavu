import './ShippingDialog.css';

function CloseIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3.5 3.5L12.5 12.5" />
            <path d="M12.5 3.5L3.5 12.5" />
        </svg>
    );
}

function ShippingDialog({ isOpen, onClose }) {
    if (!isOpen) return null;

    return (
        <div className="shipping-overlay" onClick={onClose}>
            <div className="shipping-dialog" onClick={(e) => e.stopPropagation()}>
                <button className="shipping-close" onClick={onClose} aria-label="Close shipping terms">
                    <CloseIcon />
                </button>
                <div className="shipping-content">
                    <h2 className="shipping-heading">SHIPPING</h2>
                    <p className="shipping-text">
                        Orders are usually processed within 5 working days of receiving your order. International orders will be shipped via dhl express. Buyer will receive a shipment confirmation email with the shipping tracking number. Customs duty will be charged to you depending upon the country in which you reside.
                    </p>
                    <p className="shipping-text">
                        The customs duties and taxes will vary throughout, we are unable to predict what these charges will be.
                    </p>
                    <p className="shipping-text">
                        Deja Vu is not responsible for any packages stolen or lost during transit. Any claims of this nature must be made by the customer to the appropriate carrier.
                    </p>

                    <h2 className="shipping-heading">RETURNS</h2>
                    <p className="shipping-text">
                        All garments are excluded from unjustified returns. Returns can only be accepted if an item is faulty or damaged during shipping.
                    </p>
                    <p className="shipping-text">
                        Should we have made any errors to your order (such as an incorrect size or a damaged product), please contact us at info@dejavu-studio.com. We will resolve the issue as quickly as possible.
                    </p>
                    <p className="shipping-text">
                        All items must be returned in their original state, with all the tags untouched, boxes, and dust bags must also be returned with the items. If the above conditions are not met, the items are not eligible for any refunds and/or exchanges.
                    </p>
                    <p className="shipping-text">
                        We reserve the right to refuse any washed, worn or altered items.
                    </p>
                    <p className="shipping-text">
                        Please be aware that the buyer is responsible for any return shipping costs. Deja Vu is not responsible for return shipping costs nor duty reimbursement in the case of international purchases.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default ShippingDialog;
