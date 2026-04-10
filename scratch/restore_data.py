import os
import subprocess

files = {
    "dataset/books_genre.csv": "https://huggingface.co/spaces/surabhibh05/rook/resolve/main/dataset/books_genre.csv",
    "dataset/ratings_processed.csv": "https://huggingface.co/spaces/surabhibh05/rook/resolve/main/dataset/ratings_processed.csv",
    "models/book_faiss.index": "https://huggingface.co/spaces/surabhibh05/rook/resolve/main/models/book_faiss.index",
    "models/book_meta.pkl": "https://huggingface.co/spaces/surabhibh05/rook/resolve/main/models/book_meta.pkl",
    "models/cosine_sim.pkl": "https://huggingface.co/spaces/surabhibh05/rook/resolve/main/models/cosine_sim.pkl",
    "models/svd_model.pkl": "https://huggingface.co/spaces/surabhibh05/rook/resolve/main/models/svd_model.pkl",
    "models/tfidf_vectorizer.pkl": "https://huggingface.co/spaces/surabhibh05/rook/resolve/main/models/tfidf_vectorizer.pkl",
    "models/tfidf_matrix.npz": "https://huggingface.co/spaces/surabhibh05/rook/resolve/main/models/tfidf_matrix.npz"
}

for path, url in files.items():
    print(f"Downloading {path}...")
    dir_name = os.path.dirname(path)
    if dir_name and not os.path.exists(dir_name):
        os.makedirs(dir_name)
    
    subprocess.run(["curl", "-L", url, "-o", path], check=True)
    size = os.path.getsize(path)
    print(f"Done: {path} ({size} bytes)")
