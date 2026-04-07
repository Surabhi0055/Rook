import joblib
import pandas as pd
import os

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJ_DIR = os.path.dirname(_BASE_DIR)

books = pd.read_csv(os.path.join(_PROJ_DIR, "dataset", "books_genre.csv"))

svd_model = joblib.load(os.path.join(_PROJ_DIR, "models", "svd_model.pkl"))
tfidf= joblib.load(os.path.join(_PROJ_DIR, "models", "tfidf_vectorizer.pkl"))
cosine_simi = joblib.load(os.path.join(_PROJ_DIR, "models", "cosine_sim.pkl"))