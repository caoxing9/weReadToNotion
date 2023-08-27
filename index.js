const axios = require('axios');
const dotenv = require('dotenv');
const { Client } = require('@notionhq/client');
const dayjs = require('dayjs')
const _ = require('lodash')
dayjs().format()
dotenv.config();

const WEREAD_URL = "https://weread.qq.com/"

const WEREAD_CHAPTER_INFO = "https://i.weread.qq.com/book/chapterInfos"
const WEREAD_REVIEW_LIST_URL = "https://i.weread.qq.com/review/list"

// get bookinfo by bookId
const WEREAD_BOOK_INFO = "https://i.weread.qq.com/book/info"

// read info
const WEREAD_READ_INFO_URL = "https://i.weread.qq.com/book/readinfo"

// all notes
const WEREAD_NOTEBOOKS_URL = "https://i.weread.qq.com/user/notebooks"

// note
const WEREAD_BOOKMARKLIST_URL = "https://i.weread.qq.com/book/bookmarklist"

// all books
const WEREAD_ALL_BOOKS = "https://i.weread.qq.com/shelf/friendCommon"

// get reading books status
const WEREAD_READING_BOOKS = "https://i.weread.qq.com/mine/readbook"

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const cookie = process.env.COOKIE;

const fetch = axios.create({
  headers: {
    'Cookie': cookie
  }
})

const extractCookie = (cookie, key) => {
  const reg = new RegExp(`${key}=(\\w+);`);
  const match = cookie.match(reg);
  return match?.[1] || null;
}

const getAllBooks = async () => {
  const wr_vid = extractCookie(cookie, 'wr_vid')
  return fetch.get(WEREAD_ALL_BOOKS, {
    params: { userVid: wr_vid }
  })
}

const addNotes = async (books) => {
  const { data: { updated, chapters } } = await fetch.get(WEREAD_BOOKMARKLIST_URL)
  const chaptersMap = {}
  chapters.forEach(({bookId, title, chapterUid}) => {
    chaptersMap[`${bookId}_${chapterUid}`] = title;
  })
  const noteGroup = _.groupBy(updated, 'bookId')
  return books.map((book) => {
    const currentNotes = noteGroup[book.bookId]
    const currentNoteGroup = _.groupBy(currentNotes, 'chapterUid')
    const children = []
    for (key in currentNoteGroup) {
      const noteArrs = currentNoteGroup[key]
      children.push({
        object: "block",
        type: "heading_2",
        "heading_2": {
          "rich_text": [
            {
              "type": "text",
              "text": {
                "content": chaptersMap[`${book.bookId}_${key}`],
                "link": null
              },
              "annotations": {
                "bold": false,
                "italic": false,
                "strikethrough": false,
                "underline": false,
                "code": false,
                "color": "default"
              },
              "plain_text": chaptersMap[`${book.bookId}_${key}`],
              "href": null
            }
          ],
          "color": "default",
          "is_toggleable": false
        },
      })
      noteArrs.forEach(({markText}) => {
        children.push({
          object: "block",
          type: "quote",
          "quote": {
            "rich_text": [
              {
                "type": "text",
                "text": {
                  "content": markText,
                  "link": null
                },
                "annotations": {
                  "bold": false,
                  "italic": false,
                  "strikethrough": false,
                  "underline": false,
                  "code": false,
                  "color": "default"
                },
                "plain_text": markText,
                "href": null
              }
            ],
            "color": "default",
          },
        })
      })
    }
    return {
      ...book,
      children: children
    }
  })
}

const getReadingBooks = async (books) => {
  const wr_vid = extractCookie(cookie, 'wr_vid')
  const {data: {readBooks}} = await fetch.get(WEREAD_READING_BOOKS, {
    params: {
      // including finished
      listType: 3,
      yearRange: '0_0',
      vid: wr_vid
    }
  })
  let readBooksIds = []
  let readBooksInfo = {}
  readBooks.forEach((book) => {
    const { bookId, readtime, progress, startReadingTime, finishTime = null } = book
    readBooksIds.push(bookId)
    readBooksInfo[bookId] = {
      readtime: readtime,
      progress: progress,
      startReadingTime: startReadingTime,
      finishTime: finishTime,
    }
  })
  return books.filter(({bookId}) => readBooksIds.includes(bookId)).map((book) => ({
    ...book,
    ...readBooksInfo[book.bookId]
  }))
}

const getBooksInfo = async () => {
  const { data: { recentBooks: allbooks, finishReadBooks, recentBooks }} = await getAllBooks()
  // including finished
  const readingBooks = await getReadingBooks(allbooks)

  const readBookIds = finishReadBooks.map(({bookId}) => bookId).concat(readingBooks.map(({bookId}) => bookId))

  const unReadBooks = allbooks?.filter(({bookId}) => !readBookIds.includes(bookId))

  return {
    unReadBooks,
    readingBooks
  }
}

async function main() {
  const {unReadBooks, readingBooks} = await getBooksInfo()
  const dealBooks = unReadBooks.map((book) => ({...book, bookStatus: 0})).concat(readingBooks)
  const books = await addNotes(dealBooks)
  await addNewToDatabase(books)

}

async function addNewToDatabase(books) {
  for(let i = 0; i < books.length; i++) {
    const book = books[i]
    await addToDatabase(databaseId, book)
  }
}

async function addToDatabase(databaseId, book) {
  const statusMap = ["unread", "reading", "finish"]
  const { title, cover, categories, author, bookId, startReadingTime = null, readUpdateTime = null, finishTime = null, bookStatus, progress = null, readtime = null, children = null } = book
  const properties = {
    Name: {
      type: "title",
      title: [
        {
          type: "text",
          text: {
            content: title,
          },
        }
      ],
    },
    Categroy: {
      multi_select: categories.map((category) => ({
        name: category.title
      }))
    },
    Author: {rich_text: [{type: "text", text: {content: author}}]},
    BookId: {rich_text: [{type: "text", text: {content: bookId}}]},
    "Cover": {"files": [{"type": "external", "name": "Cover", "external": {"url": cover}}]},
    ReadTime: {
      "type": "number",
      "number": readtime
    },
    "Progress": {
      "type": "number",
      "number": bookStatus === 2 ? 100 : progress
    },
    Status: {
      "status": {
        "name": statusMap[bookStatus]
      }
    }
  }
  if (startReadingTime) { 
    properties['StartReadingTime'] = {
      date: {
        start: dayjs.unix(startReadingTime).format()
      }
    }
  }
  if (readUpdateTime) { 
    properties['ReadUpdateTime'] = {
      date: {
        start: dayjs.unix(readUpdateTime).format()
      }
    }
  }
  if (finishTime) { 
    properties['FinishTime'] = {
      date: {
        start: dayjs.unix(finishTime).format()
      }
    }
  }
  try {
    notion.pages.create
      const response = await notion.pages.create({
          parent: {
              database_id: databaseId,
          },
          icon: {
              "type": "external",
              "external": {
                "url": cover
              }
          },
          properties: properties,
          children: children
      });
  } catch (error) {
      console.error(error.body);
  }
}

async function queryDatabase(databaseId) {
  try {
      const response = await notion.databases.query({
          database_id: databaseId,
          // "filter": {
          //     "property": "ID",
          //     "rich_text": {
          //         "contains": username
          //     }
          // }
        });  
  } catch (error){
      console.log(error.body);
  }
}

main();