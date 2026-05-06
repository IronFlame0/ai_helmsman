import os
from abc import ABC, abstractmethod


class EmbeddingProvider(ABC):
    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        pass

    @property
    @abstractmethod
    def dimension(self) -> int:
        pass


class LocalEmbeddingProvider(EmbeddingProvider):
    _MODEL_NAME = "all-MiniLM-L6-v2"
    _DIMENSION = 384

    def __init__(self) -> None:
        from sentence_transformers import SentenceTransformer
        self._model = SentenceTransformer(self._MODEL_NAME)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, show_progress_bar=False).tolist()

    @property
    def dimension(self) -> int:
        return self._DIMENSION


class OpenAIEmbeddingProvider(EmbeddingProvider):
    _MODEL_NAME = "text-embedding-3-small"
    _DIMENSION = 1536

    def __init__(self) -> None:
        import openai
        self._client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    def embed(self, texts: list[str]) -> list[list[float]]:
        response = self._client.embeddings.create(input=texts, model=self._MODEL_NAME)
        return [item.embedding for item in response.data]

    @property
    def dimension(self) -> int:
        return self._DIMENSION


_provider: EmbeddingProvider | None = None


def get_provider() -> EmbeddingProvider:
    global _provider
    if _provider is None:
        name = os.getenv("EMBEDDING_PROVIDER", "local")
        _provider = OpenAIEmbeddingProvider() if name == "openai" else LocalEmbeddingProvider()
    return _provider
