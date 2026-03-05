import { Link } from 'react-router-dom';
import './Entry.css';
import introPhoto from './dejavu-intro-photo.webp';

function Entry() {
  return (
    <section className="entry-page" aria-label="Deja Vu entry">
      <Link className="entry-image-wrap" to="/shop">
        <img
          className="entry-image"
          src={introPhoto}
          alt="Deja Vu SS26 model in lookbook styling"
        />
      </Link>

      <Link className="entry-collection-link" to="/shop">
        SS26 2nd Delivery
      </Link>
    </section>
  );
}

export default Entry;
