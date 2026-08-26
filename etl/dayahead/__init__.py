"""Módulo puro de parseo y transformación de precios day-ahead.

Sin I/O, sin Spark, sin dependencias fuera de la biblioteca estándar. Las funciones
reciben las respuestas crudas de cada API (bytes, str o dict) y devuelven listas de
``PriceRecord``. El notebook de Fabric orquesta: hace las llamadas HTTP, llama a estas
funciones y escribe en Delta.
"""

__version__ = "0.2.0"
