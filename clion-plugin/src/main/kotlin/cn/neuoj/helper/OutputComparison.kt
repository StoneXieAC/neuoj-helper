package cn.neuoj.helper

data class LineComparison(
  val expected: List<Boolean>, val actual: List<Boolean>,
  val missingExpected: List<Int>, val missingActual: List<Int>
)

object OutputComparison {
  private data class Part(val value: String, val line: Int)

  fun compare(expected: String, actual: String, mode: CompareMode): LineComparison {
    val expectedLines = lines(expected)
    val actualLines = lines(actual)
    val expectedParts = parts(expected, mode)
    val actualParts = parts(actual, mode)
    if (expectedParts.map { it.value } == actualParts.map { it.value }) {
      return LineComparison(List(expectedLines.size) { true }, List(actualLines.size) { true }, emptyList(), emptyList())
    }

    val pairs = matchingPairs(expectedParts.map { it.value }, actualParts.map { it.value })
    val expectedMatched = BooleanArray(expectedParts.size)
    val actualMatched = BooleanArray(actualParts.size)
    pairs.forEach { (left, right) -> expectedMatched[left] = true; actualMatched[right] = true }
    val expectedGood = MutableList(expectedLines.size) { true }
    val actualGood = MutableList(actualLines.size) { true }
    expectedParts.forEachIndexed { index, part -> if (!expectedMatched[index]) expectedGood[part.line] = false }
    actualParts.forEachIndexed { index, part -> if (!actualMatched[index]) actualGood[part.line] = false }

    val missingExpected = mutableListOf<Int>()
    val missingActual = mutableListOf<Int>()
    fun markCounterpart(parts: List<Part>, previous: Int, next: Int, unmatchedLines: List<Int>,
      good: MutableList<Boolean>, hasMissingLine: Boolean) {
      val adjacent = listOfNotNull(parts.getOrNull(previous)?.line, parts.getOrNull(next)?.line).distinct()
      if (adjacent.size == 1) good[adjacent.single()] = false
      else if (!hasMissingLine) {
        if (adjacent.isEmpty()) good[0] = false
        else unmatchedLines.forEach { line -> good[adjacent.minBy { kotlin.math.abs(it - line) }] = false }
      }
    }
    var previousLeft = -1
    var previousRight = -1
    for ((nextLeft, nextRight) in pairs + Pair(expectedParts.size, actualParts.size)) {
      val leftGap = (previousLeft + 1 until nextLeft).toList()
      val rightGap = (previousRight + 1 until nextRight).toList()
      if (mode == CompareMode.TOKENS) {
        if (leftGap.isNotEmpty() && rightGap.isEmpty())
          markCounterpart(actualParts, previousRight, nextRight, leftGap.map { expectedParts[it].line },
            actualGood, expectedLines.size > actualLines.size)
        if (rightGap.isNotEmpty() && leftGap.isEmpty())
          markCounterpart(expectedParts, previousLeft, nextLeft, rightGap.map { actualParts[it].line },
            expectedGood, actualLines.size > expectedLines.size)
      }
      if (mode == CompareMode.EXACT || expectedLines.size > actualLines.size)
        leftGap.drop(rightGap.size).forEach { missingActual.add(expectedParts[it].line + 1) }
      if (mode == CompareMode.EXACT || actualLines.size > expectedLines.size)
        rightGap.drop(leftGap.size).forEach { missingExpected.add(actualParts[it].line + 1) }
      previousLeft = nextLeft
      previousRight = nextRight
    }
    return LineComparison(expectedGood, actualGood, missingExpected.distinct(), missingActual.distinct())
  }

  private fun lines(value: String) = value.replace("\r\n", "\n").split("\n")

  private fun parts(value: String, mode: CompareMode): List<Part> {
    val normalized = if (mode == CompareMode.EXACT) value.replace("\r\n", "\n") else value
    if (mode == CompareMode.EXACT) return lines(normalized).mapIndexed { index, line -> Part(line, index) }
    var line = 0
    var cursor = 0
    return Regex("(?U)\\S+").findAll(normalized).map { match ->
      while (cursor < match.range.first) { if (normalized[cursor] == '\n') line++; cursor++ }
      Part(match.value, line)
    }.toList()
  }

  private fun matchingPairs(left: List<String>, right: List<String>): List<Pair<Int, Int>> {
    if (left.size.toLong() * right.size > 1_000_000) {
      val prefix = left.indices.takeWhile { it < right.size && left[it] == right[it] }.count()
      var suffix = 0
      while (suffix < left.size - prefix && suffix < right.size - prefix &&
        left[left.lastIndex - suffix] == right[right.lastIndex - suffix]) suffix++
      return (0 until prefix).map { it to it } + (0 until suffix).map {
        left.lastIndex - it to right.lastIndex - it
      }.asReversed()
    }
    val table = Array(left.size + 1) { IntArray(right.size + 1) }
    for (i in left.indices.reversed()) for (j in right.indices.reversed()) {
      table[i][j] = if (left[i] == right[j]) 1 + table[i + 1][j + 1]
        else maxOf(table[i + 1][j], table[i][j + 1])
    }
    val pairs = mutableListOf<Pair<Int, Int>>()
    var i = 0
    var j = 0
    while (i < left.size && j < right.size) {
      when {
        left[i] == right[j] -> { pairs.add(i to j); i++; j++ }
        table[i + 1][j] >= table[i][j + 1] -> i++
        else -> j++
      }
    }
    return pairs
  }
}
