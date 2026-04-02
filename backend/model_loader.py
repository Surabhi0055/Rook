#model_loader.py
import joblib
import pandas as pd

books = pd.read_csv("../dataset/books_genre.csv")

svd_model = joblib.load("../models/svd_model.pkl")
tfidf= joblib.load("../models/tfidf_vectorizer.pkl")
cosine_simi = joblib.load("../models/cosine_sim.pkl")